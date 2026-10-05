'use strict';

const { Worker } = require('bullmq');
const env = require('../config/env');
const notificationService = require('../services/notificationService');
const { deliverNotification } = require('../integrations/notificationTransport');
const {
  NOTIFICATION_QUEUE_NAME,
  redisConnectionOptions,
  getDeadLetterQueue,
} = require('./notificationQueue');

function log(level, event, fields = {}) {
  console[level](JSON.stringify({ level, event, ...fields }));
}

async function handleFailedNotificationJob(job, error, deadLetterQueue = getDeadLetterQueue()) {
  if (!job) return;
  const terminal = job.attemptsMade >= (job.opts.attempts || env.NOTIFICATION_QUEUE_ATTEMPTS);
  await notificationService.markNotificationAttemptFailed(job.data, error, terminal);
  log(terminal ? 'error' : 'warn', terminal ? 'notification.job_dead_lettered' : 'notification.job_retry', {
    jobId: job.id,
    notificationId: job.data.notificationId,
    attemptsMade: job.attemptsMade,
    errorCode: error.code || 'DELIVERY_FAILED',
  });
  if (terminal) {
    await deadLetterQueue.add('failed-notification', {
      ...job.data,
      originalJobId: job.id,
      errorCode: error.code || 'DELIVERY_FAILED',
      failedAt: new Date().toISOString(),
    }, { jobId: `failed-${job.id}` });
  }
}

function createNotificationWorker({ deliver = deliverNotification } = {}) {
  const worker = new Worker(
    NOTIFICATION_QUEUE_NAME,
    (job) => notificationService.processNotificationJob(job.data, deliver),
    { connection: redisConnectionOptions(), concurrency: 5 }
  );

  worker.on('completed', (job, result) => {
    log('info', 'notification.job_completed', {
      jobId: job.id,
      notificationId: job.data.notificationId,
      skipped: Boolean(result?.skipped),
    });
  });

  worker.on('failed', (job, error) => {
    handleFailedNotificationJob(job, error).catch((handlerError) => {
      log('error', 'notification.failure_handler_error', {
        jobId: job?.id,
        errorName: handlerError.name,
        errorCode: handlerError.code || null,
      });
    });
  });

  worker.on('error', (error) => {
    log('error', 'notification.worker_error', { errorName: error.name, errorCode: error.code || null });
  });
  return worker;
}

module.exports = { createNotificationWorker, handleFailedNotificationJob };