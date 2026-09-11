'use strict';

const AppError = require('../errors/AppError');
const env = require('../config/env');

/**
 * Centralized Express error handler.
 * Must be registered as the last middleware with 4 arguments.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Determine status code and code
  let statusCode = err.statusCode || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'Internal server error';
  let isOperational = err.isOperational || false;

  // Handle Mongoose validation errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
    isOperational = true;
  }

  // Handle Mongoose duplicate key errors
  if (err.code === 11000) {
    statusCode = 409;
    code = 'DUPLICATE_KEY';
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `Duplicate value for ${field}`;
    isOperational = true;
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    code = 'INVALID_TOKEN';
    message = 'Invalid token';
    isOperational = true;
  }
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'TOKEN_EXPIRED';
    message = 'Token expired';
    isOperational = true;
  }

  // Log non-operational (programming/unexpected) errors
  if (!isOperational) {
    console.error('[ERROR] Unhandled error:', err);
  }

  const response = {
    success: false,
    error: {
      code,
      message,
    },
  };

  // Include stack trace in development
  if (env.NODE_ENV === 'development' && !isOperational) {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

module.exports = { errorHandler };
