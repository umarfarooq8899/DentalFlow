'use strict';

const app = require('./app');
const env = require('./config/env');
const { connectDatabase } = require('./config/database');

const PORT = env.PORT;

async function start() {
  try {
    await connectDatabase();

    const server = app.listen(PORT, () => {
      console.log(`[SERVER] DentalFlow API running on port ${PORT} (${env.NODE_ENV})`);
    });

    // ── Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`[SERVER] ${signal} received — shutting down gracefully...`);
      server.close(async () => {
        const { disconnectDatabase } = require('./config/database');
        await disconnectDatabase();
        console.log('[SERVER] Shutdown complete.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    console.error('[SERVER] Failed to start:', err.message);
    process.exit(1);
  }
}

start();
