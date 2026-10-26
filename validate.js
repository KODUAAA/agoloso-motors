import { z } from 'zod';
import { HttpError } from './errors.js';

// Plain-language messages for the errors customers are most likely to see.
// Schemas can still pass their own message, which takes priority.
z.config({
  customError: (issue) => {
    const missing = issue.input === undefined || issue.input === null || Number.isNaN(issue.input);
    if (issue.code === 'invalid_type' && missing) return 'This field is required';
    if (issue.code === 'invalid_type' && issue.expected === 'number') return 'Enter a number';
    if (issue.code === 'too_small' && issue.origin === 'string' && issue.minimum === 1) return 'This field is required';
    if (issue.code === 'too_big' && issue.origin === 'string') return `Keep this under ${issue.maximum} characters`;
    if (issue.code === 'invalid_format' && issue.format === 'email') return 'Enter a valid email address';
    if (issue.code === 'invalid_format' && issue.format === 'date') return 'Choose a date';
    if (issue.code === 'invalid_format' && issue.format === 'url') return 'Enter a full web address starting with https://';
    if (issue.code === 'invalid_value') return 'Choose one of the options';
    return undefined;
  },
});

// Validates req.params / req.query / req.body against zod schemas.
// Parsed (and type-coerced) values are placed on req.valid.
export function validate(schemas) {
  return (req, res, next) => {
    req.valid = {};
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      let input = req[part] ?? {};
      if (part === 'query') {
        // Treat empty filters from HTML forms (?make=) as not provided
        input = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== ''));
      }
      const result = schemas[part].safeParse(input);
      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          field: issue.path.join('.') || part,
          message: issue.message,
        }));
        return next(new HttpError(400, 'Some of the information provided is invalid.', details));
      }
      req.valid[part] = result.data;
    }
    next();
  };
}

// Shared building blocks
export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const trimmed = (max = 200) => z.string().trim().min(1).max(max);
export const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullish();
export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const phone = z
  .string()
  .trim()
  .regex(/^[+()\d\s-]{7,20}$/, 'Enter a valid phone number');
