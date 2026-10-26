import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/index.js';
import { HttpError } from './errors.js';

export function signToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
    algorithm: 'HS256',
  });
}

async function userFromRequest(req) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  }
  // Look the user up so deleted accounts and role changes take effect immediately
  const { rows } = await query('SELECT id, name, email, role FROM users WHERE id = $1', [payload.sub]);
  if (!rows[0]) throw new HttpError(401, 'Your session has expired. Please sign in again.');
  return rows[0];
}

// Rejects the request unless a valid token is present
export async function requireAuth(req, res, next) {
  const user = await userFromRequest(req);
  if (!user) throw new HttpError(401, 'Please sign in to continue.');
  req.user = user;
  next();
}

// Attaches req.user when a valid token is present, but doesn't require one
export async function optionalAuth(req, res, next) {
  try {
    req.user = await userFromRequest(req);
  } catch {
    req.user = null;
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new HttpError(403, 'You do not have permission to do that.');
    }
    next();
  };
}
