import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db/index.js';
import { calculateFinance } from '../lib/finance.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { formLimiter } from '../middleware/rateLimit.js';
import { email, idParam, optionalText, pagination, phone, trimmed, validate } from '../middleware/validate.js';

const router = Router();

export const TERMS = [12, 24, 36, 48, 60, 72, 84];
const EMPLOYMENT = ['employed', 'self_employed', 'retired', 'student', 'unemployed'];
const APPLICATION_STATUSES = ['pending', 'approved', 'declined'];

const money = z.coerce.number().min(0).max(100_000_000);
const term = z.coerce.number().int().refine((n) => TERMS.includes(n), `Term must be one of ${TERMS.join(', ')} months`);

// Quick repayment estimate for the calculator
router.get(
  '/quote',
  validate({
    query: z
      .object({
        price: money.refine((n) => n > 0, 'Enter a price'),
        deposit: money.default(0),
        term_months: term.default(60),
        apr: z.coerce.number().min(0).max(100).default(config.defaultApr),
      })
      .refine((q) => q.deposit < q.price, { path: ['deposit'], message: 'Deposit must be less than the price' }),
  }),
  (req, res) => {
    const { price, deposit, term_months, apr } = req.valid.query;
    res.json({ data: { price, deposit, termMonths: term_months, apr, ...calculateFinance({ price, deposit, termMonths: term_months, apr }) } });
  },
);

const createApplication = z
  .object({
    vehicle_id: z.coerce.number().int().positive().nullish(),
    vehicle_price: money.optional(),
    deposit: money.default(0),
    term_months: term,
    name: trimmed(100),
    email,
    phone,
    employment_status: z.enum(EMPLOYMENT),
    monthly_income: money,
    consent: z.literal(true, { error: 'Please confirm you agree to be contacted about your application' }),
    website: z.string().optional(),
  })
  .refine((a) => a.vehicle_id || a.vehicle_price, {
    path: ['vehicle_price'],
    message: 'Choose a vehicle or enter the price you want to finance',
  });

router.post('/applications', formLimiter, validate({ body: createApplication }), async (req, res) => {
  const { website, consent, ...app } = req.valid.body;
  if (website) return res.status(201).json({ message: 'Application received.' });

  // Use the listed price, never one sent by the browser, when a vehicle is chosen
  let price = app.vehicle_price;
  if (app.vehicle_id) {
    const { rows } = await query('SELECT price, status FROM vehicles WHERE id = $1', [app.vehicle_id]);
    if (!rows[0]) throw new HttpError(400, 'That vehicle is no longer listed.');
    if (rows[0].status === 'sold') throw new HttpError(400, 'Sorry, that vehicle has already been sold.');
    price = rows[0].price;
  }
  if (app.deposit >= price) {
    throw new HttpError(400, 'Some of the information provided is invalid.', [
      { field: 'deposit', message: 'Deposit must be less than the vehicle price' },
    ]);
  }

  const apr = config.defaultApr;
  const { monthlyPayment } = calculateFinance({ price, deposit: app.deposit, termMonths: app.term_months, apr });
  const { rows } = await query(
    `INSERT INTO finance_applications
       (vehicle_id, name, email, phone, employment_status, monthly_income,
        vehicle_price, deposit, term_months, apr, monthly_payment)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, vehicle_price, deposit, term_months, apr, monthly_payment, status, created_at`,
    [app.vehicle_id ?? null, app.name, app.email, app.phone, app.employment_status, app.monthly_income,
      price, app.deposit, app.term_months, apr, monthlyPayment],
  );
  res.status(201).json({
    data: rows[0],
    message: 'Application received. Our finance team will contact you within one working day.',
  });
});

router.use('/applications', requireAuth, requireRole('admin', 'staff'));

router.get(
  '/applications',
  validate({ query: z.object({ status: z.enum(APPLICATION_STATUSES).optional(), ...pagination }) }),
  async (req, res) => {
    const { status, page, limit } = req.valid.query;
    const whereSql = status ? 'WHERE f.status = $1' : '';
    const params = status ? [status] : [];
    const [list, count] = await Promise.all([
      query(
        `SELECT f.*, v.year || ' ' || v.make || ' ' || v.model AS vehicle_title
         FROM finance_applications f LEFT JOIN vehicles v ON v.id = f.vehicle_id
         ${whereSql}
         ORDER BY f.created_at DESC, f.id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit],
      ),
      query(`SELECT count(*)::int AS total FROM finance_applications f ${whereSql}`, params),
    ]);
    res.json({ data: list.rows, page, limit, total: count.rows[0].total });
  },
);

router.patch(
  '/applications/:id',
  validate({
    params: idParam,
    body: z
      .object({ status: z.enum(APPLICATION_STATUSES), notes: optionalText(5000) })
      .partial()
      .refine((body) => Object.keys(body).length > 0, 'Provide a status or notes.'),
  }),
  async (req, res) => {
    const { status, notes } = req.valid.body;
    const { rows } = await query(
      `UPDATE finance_applications SET
         status = COALESCE($1, status),
         notes  = CASE WHEN $2::boolean THEN $3 ELSE notes END
       WHERE id = $4 RETURNING *`,
      [status ?? null, notes !== undefined, notes ?? null, req.valid.params.id],
    );
    if (!rows[0]) throw new HttpError(404, 'Application not found.');
    res.json({ data: rows[0] });
  },
);

router.delete('/applications/:id', requireRole('admin'), validate({ params: idParam }), async (req, res) => {
  const { rowCount } = await query('DELETE FROM finance_applications WHERE id = $1', [req.valid.params.id]);
  if (!rowCount) throw new HttpError(404, 'Application not found.');
  res.status(204).end();
});

export default router;
