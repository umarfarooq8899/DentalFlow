'use strict';

const mongoose = require('mongoose');
const env = require('./env');

let isConnected = false;

async function connectDatabase() {
  if (isConnected) return;

  const uri = env.MONGODB_URI;

  mongoose.connection.on('connected', () => {
    console.log('[DB] MongoDB connected');
    isConnected = true;
  });

  mongoose.connection.on('disconnected', () => {
    console.log('[DB] MongoDB disconnected');
    isConnected = false;
  });

  mongoose.connection.on('error', (err) => {
    console.error('[DB] MongoDB error:', err.message);
  });

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
  });
}

async function disconnectDatabase() {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
  console.log('[DB] MongoDB connection closed');
}

module.exports = { connectDatabase, disconnectDatabase };
