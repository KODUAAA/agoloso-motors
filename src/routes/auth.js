import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { requireAuth, requireRole, signToken } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { email, idParam, trimmed, validate } from '../middleware/validate.js';

const router = Router();

const password = z.string().min(10, 'Password must be at least 10 characters').max(128);
// Compared against when the email doesn't exist, so response time doesn't reveal which emails are registered
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

router.post(
  '/login',
  loginLimiter,
  validate({ body: z.object({ email, password: z.string().min(1).max(128) }) }),
  async (req, res) => {
    const { email, password } = req.valid.body;
    const { rows } = await query(
      'SELECT id, name, email, role, password_hash FROM users WHERE lower(email) = $1',
      [email],
    );
    const user = rows[0];
    const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, 'Incorrect email or password.');

    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    const { password_hash, ...publicUser } = user;
    res.json({ token: signToken(user), user: publicUser });
  },
);

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.put(
  '/password',
  requireAuth,
  validate({ body: z.object({ current_password: z.string().min(1), new_password: password }) }),
  async (req, res) => {
    const { current_password, new_password } = req.valid.body;
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(current_password, rows[0].password_hash))) {
      throw new HttpError(400, 'Your current password is incorrect.');
    }
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      await bcrypt.hash(new_password, 12),
      req.user.id,
    ]);
    res.json({ message: 'Password updated.' });
  },
);

// Staff account management (admins only)
router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { rows } = await query(
    'SELECT id, name, email, role, last_login_at, created_at FROM users ORDER BY created_at',
  );
  res.json({ data: rows });
});

router.post(
  '/users',
  requireAuth,
  requireRole('admin'),
  validate({
    body: z.object({ name: trimmed(100), email, password, role: z.enum(['admin', 'staff']).default('staff') }),
  }),
  async (req, res) => {
    const { name, email, password, role } = req.valid.body;
    const { rows } = await query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, created_at`,
      [name, email, await bcrypt.hash(password, 12), role],
    );
    res.status(201).json({ data: rows[0] });
  },
);

router.delete('/users/:id', requireAuth, requireRole('admin'), validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params;
  if (id === req.user.id) throw new HttpError(400, "You can't delete your own account.");
  const { rowCount } = await query('DELETE FROM users WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'User not found.');
  res.status(204).end();
});

export default router;
