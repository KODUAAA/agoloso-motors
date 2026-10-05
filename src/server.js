import { createApp } from './app.js';
import { assertConfig, config } from './config.js';
import { pool } from './db/index.js';

assertConfig('databaseUrl', 'jwtSecret');

const server = createApp().listen(config.port, () => {
  console.log(`${config.dealershipName} running at http://localhost:${config.port}`);
});

// Finish in-flight requests and close database connections on shutdown (e.g. during a redeploy)
function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
