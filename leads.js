import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { formLimiter } from '../middleware/rateLimit.js';
import { email, idParam, optionalText, pagination, phone, trimmed, validate } from '../middleware/validate.js';

const router = Router();

const LEAD_TYPES = ['enquiry', 'test_drive', 'contact'];
const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'closed'];

const today = () => new Date().toISOString().slice(0, 10);

// Each lead type has its own required fields, so every problem is reported at once
const leadBase = {
  vehicle_id: z.coerce.number().int().positive().nullish(),
  name: trimmed(100),
  email,
  phone: phone.nullish(),
  message: optionalText(2000),
  // Hidden "honeypot" field: real visitors never fill it in, spam bots usually do
  website: z.string().optional(),
};

const createLead = z.discriminatedUnion('type', [
  z.object({ ...leadBase, type: z.literal('enquiry') }),
  z.object({
    ...leadBase,
    type: z.literal('test_drive'),
    vehicle_id: z.coerce.number().int().positive(),
    phone,
    preferred_date: z.iso.date().refine((date) => date >= today(), 'Choose today or a later date'),
  }),
  z.object({ ...leadBase, type: z.literal('contact'), message: z.string().trim().min(1, 'Enter a message').max(2000) }),
]);

router.post('/', formLimiter, validate({ body: createLead }), async (req, res) => {
  const { website, ...lead } = req.valid.body;
  if (website) return res.status(201).json({ message: 'Thanks! We will be in touch shortly.' });

  if (lead.vehicle_id) {
    const { rows } = await query('SELECT status FROM vehicles WHERE id = $1', [lead.vehicle_id]);
    if (!rows[0]) throw new HttpError(400, 'That vehicle is no longer listed.');
    if (rows[0].status === 'sold') throw new HttpError(400, 'Sorry, that vehicle has already been sold.');
  }

  const { rows } = await query(
    `INSERT INTO leads (type, vehicle_id, name, email, phone, message, preferred_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, type, created_at`,
    [lead.type, lead.vehicle_id ?? null, lead.name, lead.email, lead.phone ?? null, lead.message ?? null,
      lead.preferred_date ?? null],
  );
  res.status(201).json({ data: rows[0], message: 'Thanks! We will be in touch shortly.' });
});

router.use(requireAuth, requireRole('admin', 'staff'));

router.get(
  '/',
  validate({
    query: z.object({
      status: z.enum(LEAD_STATUSES).optional(),
      type: z.enum(LEAD_TYPES).optional(),
      q: z.string().trim().max(100).optional(),
      ...pagination,
    }),
  }),
  async (req, res) => {
    const f = req.valid.query;
    const where = [];
    const params = [];
    if (f.status) where.push(`l.status = $${params.push(f.status)}`);
    if (f.type) where.push(`l.type = $${params.push(f.type)}`);
    if (f.q) {
      const n = params.push(`%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`(l.name ILIKE $${n} OR l.email ILIKE $${n} OR l.phone ILIKE $${n})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [list, count] = await Promise.all([
      query(
        `SELECT l.*, v.year || ' ' || v.make || ' ' || v.model AS vehicle_title
         FROM leads l LEFT JOIN vehicles v ON v.id = l.vehicle_id
         ${whereSql}
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, f.limit, (f.page - 1) * f.limit],
      ),
      query(`SELECT count(*)::int AS total FROM leads l ${whereSql}`, params),
    ]);
    res.json({ data: list.rows, page: f.page, limit: f.limit, total: count.rows[0].total });
  },
);

router.patch(
  '/:id',
  validate({
    params: idParam,
    body: z
      .object({ status: z.enum(LEAD_STATUSES), notes: optionalText(5000) })
      .partial()
      .refine((body) => Object.keys(body).length > 0, 'Provide a status or notes.'),
  }),
  async (req, res) => {
    const { status, notes } = req.valid.body;
    const { rows } = await query(
      `UPDATE leads SET
         status = COALESCE($1, status),
         notes  = CASE WHEN $2::boolean THEN $3 ELSE notes END
       WHERE id = $4 RETURNING *`,
      [status ?? null, notes !== undefined, notes ?? null, req.valid.params.id],
    );
    if (!rows[0]) throw new HttpError(404, 'Lead not found.');
    res.json({ data: rows[0] });
  },
);

router.delete('/:id', requireRole('admin'), validate({ params: idParam }), async (req, res) => {
  const { rowCount } = await query('DELETE FROM leads WHERE id = $1', [req.valid.params.id]);
  if (!rowCount) throw new HttpError(404, 'Lead not found.');
  res.status(204).end();
});

export default router;
