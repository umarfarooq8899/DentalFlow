'use strict';

const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const env = require('../config/env');

const NOTIFICATION_QUEUE_NAME = 'dentalflow-notifications';
const NOTIFICATION_JOB_DEFAULTS = {
  attempts: env.NOTIFICATION_QUEUE_ATTEMPTS,
  backoff: { type: 'exponential', delay: env.NOTIFICATION_QUEUE_BACKOFF_MS },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: false,
};
let notificationQueue;
let deadLetterQueue;
let enqueueAdapter = null;

function setNotificationEnqueueAdapter(adapter) {
  enqueueAdapter = adapter;
}

function redisConnectionOptions(redisUrl = env.REDIS_URL) {
  const parsed = new URL(redisUrl);
  const options = {
    host: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === 'rediss:' ? 6380 : 6379)),
    maxRetriesPerRequest: null,
  };
  if (parsed.username) options.username = decodeURIComponent(parsed.username);
  if (parsed.password) options.password = decodeURIComponent(parsed.password);
  const database = parsed.pathname.replace(/^\//, '');
  if (database) options.db = Number(database);
  if (parsed.protocol === 'rediss:') options.tls = {};
  return options;
}

/**
 * Checks if Redis server is reachable without triggering unhandled error loops.
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function isRedisAvailable(timeoutMs = 1200) {
  return new Promise((resolve) => {
    let client;
    try {
      const options = redisConnectionOptions();
      client = new IORedis({
        ...options,
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });

      client.on('error', () => {});

      const timer = setTimeout(() => {
        try { client.disconnect(); } catch {}
        resolve(false);
      }, timeoutMs);

      client.connect()
        .then(() => client.ping())
        .then(() => {
          clearTimeout(timer);
          try { client.disconnect(); } catch {}
          resolve(true);
        })
        .catch(() => {
          clearTimeout(timer);
          try { client.disconnect(); } catch {}
          resolve(false);
        });
    } catch {
      resolve(false);
    }
  });
}

function getNotificationQueue() {
  if (!notificationQueue) {
    notificationQueue = new Queue(NOTIFICATION_QUEUE_NAME, {
      connection: redisConnectionOptions(),
      defaultJobOptions: NOTIFICATION_JOB_DEFAULTS,
    });
  }
  return notificationQueue;
}

function getDeadLetterQueue() {
  if (!deadLetterQueue) {
    deadLetterQueue = new Queue(`${NOTIFICATION_QUEUE_NAME}-dead-letter`, {
      connection: redisConnectionOptions(),
      defaultJobOptions: { removeOnComplete: false, removeOnFail: false },
    });
  }
  return deadLetterQueue;
}

async function enqueueNotification(notification) {
  if (enqueueAdapter) return enqueueAdapter(notification);
  const delay = Math.max(0, new Date(notification.scheduledAt).getTime() - Date.now());
  try {
    return await getNotificationQueue().add(
      'deliver-notification',
      { clinicId: notification.clinicId, notificationId: String(notification._id || notification.id) },
      { jobId: String(notification._id || notification.id), delay }
    );
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'notification.enqueue_failed',
      notificationId: String(notification._id || notification.id),
      errorName: error.name,
      errorCode: error.code || null,
    }));
    return null;
  }
}

async function closeQueues() {
  const closing = [];
  if (notificationQueue) closing.push(notificationQueue.close());
  if (deadLetterQueue) closing.push(deadLetterQueue.close());
  await Promise.all(closing);
  notificationQueue = null;
  deadLetterQueue = null;
}

module.exports = {
  NOTIFICATION_QUEUE_NAME,
  NOTIFICATION_JOB_DEFAULTS,
  redisConnectionOptions,
  isRedisAvailable,
  getNotificationQueue,
  getDeadLetterQueue,
  enqueueNotification,
  setNotificationEnqueueAdapter,
  closeQueues,
};