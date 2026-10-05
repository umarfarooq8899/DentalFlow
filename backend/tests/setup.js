'use strict';

const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { setNotificationEnqueueAdapter } = require('../src/jobs/notificationQueue');

global.__notificationJobs = new Map();
setNotificationEnqueueAdapter(async (notification) => {
  const id = String(notification._id || notification.id);
  global.__notificationJobs.set(id, { id, scheduledAt: notification.scheduledAt });
  return { id };
});

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongod.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(async () => {
  global.__notificationJobs.clear();
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});
