'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const { requestLogger } = require('./middlewares/requestLogger');
const { errorHandler } = require('./middlewares/errorHandler');
const v1Router = require('./routes/v1');

const app = express();

// ── Security headers
app.use(helmet());

// ── CORS
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  })
);

// ── Rate limiting
app.use(
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests.' } },
  })
);

// ── Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Request logging
app.use(requestLogger);

// ── API routes
app.use('/api/v1', v1Router);

// ── 404 fallback
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found.` },
  });
});

// ── Error handler (must be last)
app.use(errorHandler);

module.exports = app;
