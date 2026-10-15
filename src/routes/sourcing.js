// "Find me a car" requests: customers ask for a car that isn't in stock and
// staff track sourcing it through to delivery.
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { formLimiter } from '../middleware/rateLimit.js';
import { email, idParam, optionalText, pagination, phone, trimmed, validate } from '../middleware/validate.js';

const router = Router();

export const TIMEFRAMES = ['asap', 'within_1_month', 'within_3_months', 'flexible'];
export const SOURCING_STATUSES = ['new', 'searching', 'quote_sent', 'deposit_paid', 'shipping', 'delivered', 'cancelled'];
// Requests still being worked on
const OPEN_STATUSES = SOURCING_STATUSES.filter((s) => s !== 'delivered' && s !== 'cancelled');

const year = z.coerce.number().int().min(1950).max(new Date().getFullYear() + 1);

const createRequest = z
  .object({
    make: trimmed(60),
    model: trimmed(80),
    year_min: year.nullish(),
    year_max: year.nullish(),
    trim: optionalText(80),
    color: optionalText(40),
    max_mileage: z.coerce.number().int().min(0).max(2_000_000).nullish(),
    budget: z.coerce.number().positive('Enter your budget').max(100_000_000),
    timeframe: z.enum(TIMEFRAMES),
    name: trimmed(100),
    email,
    phone,
    message: optionalText(2000),
    // Hidden "honeypot" field: real visitors never fill it in, spam bots usually do
    website: z.string().optional(),
  })
  .refine((r) => !r.year_min || !r.year_max || r.year_min <= r.year_max, {
    path: ['year_max'],
    message: 'The latest year must be the same as or after the earliest year',
  });

router.post('/', formLimiter, validate({ body: createRequest }), async (req, res) => {
  const { website, ...r } = req.valid.body;
  const message = 'We will start searching and contact you within one working day.';
  if (website) return res.status(201).json({ message });

  const { rows } = await query(
    `INSERT INTO sourcing_requests
       (make, model, year_min, year_max, trim, color, max_mileage, budget, timeframe, name, email, phone, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, status, created_at`,
    [r.make, r.model, r.year_min ?? null, r.year_max ?? null, r.trim ?? null, r.color ?? null, r.max_mileage ?? null,
      r.budget, r.timeframe, r.name, r.email, r.phone, r.message ?? null],
  );
  res.status(201).json({ data: rows[0], message });
});

router.use(requireAuth, requireRole('admin', 'staff'));

router.get(
  '/',
  validate({
    query: z.object({
      status: z.enum([...SOURCING_STATUSES, 'open']).optional(),
      q: z.string().trim().max(100).optional(),
      ...pagination,
    }),
  }),
  async (req, res) => {
    const f = req.valid.query;
    const where = [];
    const params = [];
    if (f.status === 'open') where.push(`status = ANY($${params.push(OPEN_STATUSES)})`);
    else if (f.status) where.push(`status = $${params.push(f.status)}`);
    if (f.q) {
      const n = params.push(`%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`(name ILIKE $${n} OR email ILIKE $${n} OR phone ILIKE $${n} OR make ILIKE $${n} OR model ILIKE $${n})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [list, count] = await Promise.all([
      query(
        `SELECT * FROM sourcing_requests ${whereSql}
         ORDER BY created_at DESC, id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, f.limit, (f.page - 1) * f.limit],
      ),
      query(`SELECT count(*)::int AS total FROM sourcing_requests ${whereSql}`, params),
    ]);
    res.json({ data: list.rows, page: f.page, limit: f.limit, total: count.rows[0].total });
  },
);

router.patch(
  '/:id',
  validate({
    params: idParam,
    body: z
      .object({
        status: z.enum(SOURCING_STATUSES),
        quote_amount: z.coerce.number().min(0).max(100_000_000).nullable(),
        notes: optionalText(5000),
      })
      .partial()
      .refine((body) => Object.keys(body).length > 0, 'Provide something to update.'),
  }),
  async (req, res) => {
    // Column names come from the zod schema keys, never from raw user input
    const entries = Object.entries(req.valid.body);
    const { rows } = await query(
      `UPDATE sourcing_requests SET ${entries.map(([column], i) => `${column} = $${i + 1}`).join(', ')}
       WHERE id = $${entries.length + 1} RETURNING *`,
      [...entries.map(([, value]) => value ?? null), req.valid.params.id],
    );
    if (!rows[0]) throw new HttpError(404, 'Request not found.');
    res.json({ data: rows[0] });
  },
);

router.delete('/:id', requireRole('admin'), validate({ params: idParam }), async (req, res) => {
  const { rowCount } = await query('DELETE FROM sourcing_requests WHERE id = $1', [req.valid.params.id]);
  if (!rowCount) throw new HttpError(404, 'Request not found.');
  res.status(204).end();
});

export default router;
