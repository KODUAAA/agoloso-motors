export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFound(req, res) {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
}

// Postgres error codes that are the client's fault rather than a server bug
const PG_CLIENT_ERRORS = {
  23503: [400, 'Referenced record does not exist.'],
  23505: [409, 'A record with these details already exists.'],
  23514: [400, 'A value is outside the allowed range.'],
  '22P02': [400, 'Invalid input value.'],
};

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.details && { details: err.details }) });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  const pgError = PG_CLIENT_ERRORS[err.code];
  if (pgError) {
    return res.status(pgError[0]).json({ error: pgError[1] });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}
