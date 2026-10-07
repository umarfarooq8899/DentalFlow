'use strict';

const app = require('./app');
const env = require('./config/env');
const { connectDatabase } = require('./config/database');
const { createNotificationWorker } = require('./jobs/notificationWorker');
const { closeQueues } = require('./jobs/notificationQueue');
const notificationService = require('./services/notificationService');
const recallService = require('./services/recallService');

const PORT = env.PORT;

async function start() {
  try {
    await connectDatabase();
    let notificationWorker = null;
    try {
      const worker = createNotificationWorker();
      await Promise.race([
        worker.waitUntilReady(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Redis connection timed out (2s)')), 2000)
        ),
      ]);
      notificationWorker = worker;
      await notificationService.requeuePendingNotifications();
      await notificationService.schedulePendingAppointmentReminders();
      await recallService.scheduleActiveRecallNotifications();
    } catch (queueErr) {
      console.warn('[JOBS] Warning: Redis is not reachable. Background BullMQ workers paused until Redis is running.');
      if (notificationWorker) {
        await notificationWorker.close().catch(() => {});
        notificationWorker = null;
      }
    }

    const server = app.listen(PORT, () => {
      console.log(`[SERVER] DentalFlow API running on port ${PORT} (${env.NODE_ENV})`);
    });

    // ── Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`[SERVER] ${signal} received — shutting down gracefully...`);
      server.close(async () => {
        const { disconnectDatabase } = require('./config/database');
        if (notificationWorker) await notificationWorker.close().catch(() => {});
        await closeQueues().catch(() => {});
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
