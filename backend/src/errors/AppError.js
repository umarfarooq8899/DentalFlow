'use strict';

class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   * @param {string} [code]
   * @param {object} [meta]
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', meta = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.meta = meta;
    this.isOperational = true;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  static badRequest(message, code = 'BAD_REQUEST', meta = {}) {
    return new AppError(message, 400, code, meta);
  }

  static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    return new AppError(message, 401, code);
  }

  static forbidden(message = 'Forbidden', code = 'FORBIDDEN') {
    return new AppError(message, 403, code);
  }

  static notFound(message = 'Not found', code = 'NOT_FOUND') {
    return new AppError(message, 404, code);
  }

  static conflict(message, code = 'CONFLICT') {
    return new AppError(message, 409, code);
  }

  static internal(message = 'Internal server error', code = 'INTERNAL_ERROR') {
    return new AppError(message, 500, code);
  }
}

module.exports = AppError;
