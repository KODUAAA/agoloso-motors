import fs from 'node:fs';
import pg from 'pg';
import { assertConfig, config } from '../config.js';

assertConfig('databaseUrl');

// Return NUMERIC columns (prices, rates) as numbers instead of strings.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => (value === null ? null : parseFloat(value)));
// Keep DATE columns as plain 'YYYY-MM-DD' strings so they don't shift with time zones.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

// SSL is configured below; an sslmode in the URL would override it and make
// pg reject Supabase's certificate chain.
const url = new URL(config.databaseUrl);
url.searchParams.delete('sslmode');

function sslOptions() {
  if (!config.databaseSsl) return false;
  if (config.databaseCaCert) {
    // Accept either the certificate text itself or a path to the downloaded .crt file
    const ca = config.databaseCaCert.includes('BEGIN CERTIFICATE')
      ? config.databaseCaCert.replace(/\\n/g, '\n')
      : fs.readFileSync(config.databaseCaCert, 'utf8');
    return { ca, rejectUnauthorized: true };
  }
  console.warn(
    'DATABASE_CA_CERT is not set: the database connection is encrypted but the server certificate is not verified. ' +
      'Download the CA certificate from Supabase (Project Settings -> Database -> SSL Configuration) and set DATABASE_CA_CERT.',
  );
  return { rejectUnauthorized: false };
}

export const pool = new pg.Pool({
  connectionString: url.toString(),
  ssl: sslOptions(),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
