import 'dotenv/config';

const env = process.env;

export const config = {
  env: env.NODE_ENV ?? 'development',
  port: Number(env.PORT ?? 5000),

  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL !== 'false',
  databaseCaCert: env.DATABASE_CA_CERT,

  jwtSecret: env.JWT_SECRET,
  jwtExpiresIn: env.JWT_EXPIRES_IN ?? '8h',

  corsOrigins: (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  // Number of reverse proxies in front of the app (Render, Railway, etc. use one).
  // Needed so rate limiting sees the real visitor IP.
  trustProxy: Number(env.TRUST_PROXY ?? 1),

  dealershipName: env.DEALERSHIP_NAME ?? 'Lamont Motors',
  currency: env.CURRENCY ?? 'USD',
  distanceUnit: env.DISTANCE_UNIT === 'mi' ? 'mi' : 'km',
  defaultApr: Number(env.DEFAULT_APR ?? 9.9),
};

export const isProduction = config.env === 'production';

export function assertConfig(...keys) {
  const missing = keys.filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(
      `Missing configuration: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`,
    );
  }
  if (keys.includes('jwtSecret') && config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long.');
  }
}
