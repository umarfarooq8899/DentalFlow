'use strict';

const dotenv = require('dotenv');
const path = require('path');

// Loads .env from the root directory (D:\projects\DentalFlow\backend\.env)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '5000', 10),
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/dentalflow',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  APPOINTMENT_REMINDER_LEAD_HOURS: parseInt(process.env.APPOINTMENT_REMINDER_LEAD_HOURS || '24', 10),
  NOTIFICATION_QUEUE_ATTEMPTS: parseInt(process.env.NOTIFICATION_QUEUE_ATTEMPTS || '5', 10),
  NOTIFICATION_QUEUE_BACKOFF_MS: parseInt(process.env.NOTIFICATION_QUEUE_BACKOFF_MS || '1000', 10),
  JWT_SECRET: process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || 'dev-jwt-secret-change-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || process.env.JWT_ACCESS_EXPIRATION || '15m',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-in-production',
  JWT_REFRESH_EXPIRES_IN:
    process.env.JWT_REFRESH_EXPIRES_IN ||
    (process.env.JWT_REFRESH_EXPIRATION_DAYS ? `${process.env.JWT_REFRESH_EXPIRATION_DAYS}d` : '7d'),
  BCRYPT_ROUNDS:
    process.env.NODE_ENV === 'test' ? 4 : parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  RATE_LIMIT_MAX: process.env.NODE_ENV === 'test' ? 100000 : parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  CORS_ORIGIN: process.env.CORS_ORIGIN || process.env.CLIENT_URL || 'http://localhost:3000',
  // S3-compatible private object storage
  S3_ENDPOINT: process.env.S3_ENDPOINT || '',
  S3_REGION: process.env.S3_REGION || 'us-east-1',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || '',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || '',
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME || 'dentalflow-documents',
  S3_SIGNED_URL_EXPIRES_SECONDS: parseInt(process.env.S3_SIGNED_URL_EXPIRES_SECONDS || '900', 10),
};

module.exports = env;