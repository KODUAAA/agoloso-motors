import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { optionalAuth, requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { idParam, optionalText, pagination, trimmed, validate } from '../middleware/validate.js';

const router = Router();

export const FUEL_TYPES = ['petrol', 'diesel', 'hybrid', 'electric'];
export const TRANSMISSIONS = ['automatic', 'manual'];
export const BODY_TYPES = ['sedan', 'suv', 'hatchback', 'coupe', 'pickup', 'van', 'convertible', 'wagon'];
export const STATUSES = ['available', 'reserved', 'sold'];
const PUBLIC_STATUSES = ['available', 'reserved'];

const SORTS = {
  newest: 'created_at DESC',
  price_asc: 'price ASC',
  price_desc: 'price DESC',
  mileage_asc: 'mileage ASC',
  year_desc: 'year DESC',
};

// No defaults here, so a partial update only touches the fields that were sent
const vehicleFields = z.object({
  make: trimmed(60),
  model: trimmed(80),
  year: z.coerce.number().int().min(1950).max(new Date().getFullYear() + 1),
  price: z.coerce.number().min(0).max(100_000_000),
  mileage: z.coerce.number().int().min(0).max(2_000_000),
  fuel_type: z.enum(FUEL_TYPES),
  transmission: z.enum(TRANSMISSIONS),
  body_type: z.enum(BODY_TYPES),
  color: optionalText(40),
  engine: optionalText(80),
  description: optionalText(5000),
  images: z.array(z.url({ protocol: /^https?$/ }).max(1000)).max(20),
  status: z.enum(STATUSES),
  featured: z.boolean(),
});

const createVehicle = vehicleFields.extend({
  mileage: vehicleFields.shape.mileage.default(0),
  images: vehicleFields.shape.images.default([]),
  status: vehicleFields.shape.status.default('available'),
  featured: vehicleFields.shape.featured.default(false),
});

const updateVehicle = vehicleFields
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update.');

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  make: z.string().trim().max(60).optional(),
  body_type: z.enum(BODY_TYPES).optional(),
  fuel_type: z.enum(FUEL_TYPES).optional(),
  transmission: z.enum(TRANSMISSIONS).optional(),
  min_price: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  min_year: z.coerce.number().int().optional(),
  max_year: z.coerce.number().int().optional(),
  max_mileage: z.coerce.number().int().min(0).optional(),
  status: z.enum([...STATUSES, 'all']).optional(),
  featured: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  sort: z.enum(Object.keys(SORTS)).default('newest'),
  page: pagination.page,
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

const escapeLike = (text) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

router.get('/', optionalAuth, validate({ query: listQuery }), async (req, res) => {
  const f = req.valid.query;
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replaceAll('?', `$${params.length}`));
  };

  // Visitors only see cars that are for sale; signed-in staff can see everything
  if (!req.user) {
    if (f.status && PUBLIC_STATUSES.includes(f.status)) add('status = ?', f.status);
    else add('status = ANY(?)', PUBLIC_STATUSES);
  } else if (f.status && f.status !== 'all') {
    add('status = ?', f.status);
  }

  if (f.q) add(`(make || ' ' || model || ' ' || coalesce(description, '')) ILIKE ?`, `%${escapeLike(f.q)}%`);
  if (f.make) add('lower(make) = lower(?)', f.make);
  if (f.body_type) add('body_type = ?', f.body_type);
  if (f.fuel_type) add('fuel_type = ?', f.fuel_type);
  if (f.transmission) add('transmission = ?', f.transmission);
  if (f.min_price !== undefined) add('price >= ?', f.min_price);
  if (f.max_price !== undefined) add('price <= ?', f.max_price);
  if (f.min_year !== undefined) add('year >= ?', f.min_year);
  if (f.max_year !== undefined) add('year <= ?', f.max_year);
  if (f.max_mileage !== undefined) add('mileage <= ?', f.max_mileage);
  if (f.featured !== undefined) add('featured = ?', f.featured);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (f.page - 1) * f.limit;

  const [list, count] = await Promise.all([
    query(
      `SELECT * FROM vehicles ${whereSql}
       ORDER BY ${SORTS[f.sort]}, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, f.limit, offset],
    ),
    query(`SELECT count(*)::int AS total FROM vehicles ${whereSql}`, params),
  ]);

  res.json({ data: list.rows, page: f.page, limit: f.limit, total: count.rows[0].total });
});

// Makes currently in stock, for the search filter dropdown
router.get('/makes', async (req, res) => {
  const { rows } = await query(
    `SELECT make, count(*)::int AS count FROM vehicles
     WHERE status = ANY($1) GROUP BY make ORDER BY make`,
    [PUBLIC_STATUSES],
  );
  res.json({ data: rows });
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const { rows } = await query('SELECT * FROM vehicles WHERE id = $1', [req.valid.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Vehicle not found.');
  res.json({ data: rows[0] });
});

router.post('/', requireAuth, requireRole('admin', 'staff'), validate({ body: createVehicle }), async (req, res) => {
  const columns = Object.keys(req.valid.body);
  const values = Object.values(req.valid.body);
  const { rows } = await query(
    `INSERT INTO vehicles (${columns.join(', ')})
     VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING *`,
    values,
  );
  res.status(201).json({ data: rows[0] });
});

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin', 'staff'),
  validate({ params: idParam, body: updateVehicle }),
  async (req, res) => {
    // Column names come from the zod schema keys, never from raw user input
    const entries = Object.entries(req.valid.body);
    const { rows } = await query(
      `UPDATE vehicles SET ${entries.map(([column], i) => `${column} = $${i + 1}`).join(', ')}
       WHERE id = $${entries.length + 1}
       RETURNING *`,
      [...entries.map(([, value]) => value), req.valid.params.id],
    );
    if (!rows[0]) throw new HttpError(404, 'Vehicle not found.');
    res.json({ data: rows[0] });
  },
);

router.delete('/:id', requireAuth, requireRole('admin'), validate({ params: idParam }), async (req, res) => {
  const { rowCount } = await query('DELETE FROM vehicles WHERE id = $1', [req.valid.params.id]);
  if (!rowCount) throw new HttpError(404, 'Vehicle not found.');
  res.status(204).end();
});

export default router;
