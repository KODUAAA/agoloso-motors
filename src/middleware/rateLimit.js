import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';

const common = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => config.env === 'test',
};

// Slows down password guessing
export const loginLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' },
});

// Stops the public forms from being used to flood the inbox
export const formLimiter = rateLimit({
  ...common,
  windowMs: 60 * 60 * 1000,
  limit: 20,
  message: { error: 'Too many submissions from your connection. Please try again later.' },
});
