import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, isProduction } from './config.js';
import { query } from './db/index.js';
import { errorHandler, notFound } from './middleware/errors.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import financeRoutes, { TERMS } from './routes/finance.js';
import leadRoutes from './routes/leads.js';
import sourcingRoutes, { TIMEFRAMES } from './routes/sourcing.js';
import statsRoutes from './routes/stats.js';
import vehicleRoutes, { BODY_TYPES, FUEL_TYPES, TRANSMISSIONS } from './routes/vehicles.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp() {
  const app = express();

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Vehicle photos can be hosted anywhere (Supabase Storage, Unsplash, etc.)
          'img-src': ["'self'", 'data:', 'https:'],
          // Background videos are served from public/media/videos
          'media-src': ["'self'"],
          'upgrade-insecure-requests': isProduction ? [] : null,
        },
      },
    }),
  );
  // Only needed when the frontend is hosted on a different domain from this API
  if (config.corsOrigins.length) app.use('/api', cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', async (req, res) => {
    try {
      await query('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch {
      res.status(503).json({ status: 'error', database: 'unreachable' });
    }
  });

  // Settings the website needs to render forms and prices
  app.get('/api/config', (req, res) => {
    res.json({
      dealershipName: config.dealershipName,
      currency: config.currency,
      distanceUnit: config.distanceUnit,
      defaultApr: config.defaultApr,
      financeTerms: TERMS,
      bodyTypes: BODY_TYPES,
      fuelTypes: FUEL_TYPES,
      transmissions: TRANSMISSIONS,
      sourcingTimeframes: TIMEFRAMES,
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/vehicles', vehicleRoutes);
  app.use('/api/leads', leadRoutes);
  app.use('/api/finance', financeRoutes);
  app.use('/api/catalog', catalogRoutes);
  app.use('/api/sourcing', sourcingRoutes);
  app.use('/api/stats', statsRoutes);
  app.use('/api', notFound);

  // The website itself; "extensions" lets /vehicle serve vehicle.html
  app.use(express.static(publicDir, { extensions: ['html'] }));
  app.use((req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));

  app.use(errorHandler);
  return app;
}
