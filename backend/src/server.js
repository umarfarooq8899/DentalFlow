'use strict';

const app = require('./app');
const env = require('./config/env');
const { connectDatabase } = require('./config/database');
const { createNotificationWorker } = require('./jobs/notificationWorker');
const { closeQueues, isRedisAvailable } = require('./jobs/notificationQueue');
const notificationService = require('./services/notificationService');
const recallService = require('./services/recallService');

const PORT = env.PORT;

async function start() {
  try {
    await connectDatabase();
    let notificationWorker = null;
    const redisAvailable = await isRedisAvailable(1200);
    if (redisAvailable) {
      try {
        notificationWorker = createNotificationWorker();
        await notificationWorker.waitUntilReady();
        await notificationService.requeuePendingNotifications();
        await notificationService.schedulePendingAppointmentReminders();
        await recallService.scheduleActiveRecallNotifications();
        console.log('[JOBS] BullMQ notification worker initialized and ready.');
      } catch (queueErr) {
        console.warn('[JOBS] Warning: Redis worker initialization failed:', queueErr.message);
        if (notificationWorker) {
          await notificationWorker.close().catch(() => {});
          notificationWorker = null;
        }
      }
    } else {
      console.warn('[JOBS] Notice: Redis is not reachable. Background BullMQ workers disabled for this session.');
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
