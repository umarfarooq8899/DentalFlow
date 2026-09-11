'use strict';

const { verifyAccessToken } = require('../utils/jwt');
const AppError = require('../errors/AppError');

/**
 * Middleware to authenticate requests using JWT access tokens.
 * Sets req.user on success.
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(AppError.unauthorized('Missing or invalid Authorization header.'));
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return next(AppError.unauthorized('Token not provided.'));
    }

    const decoded = verifyAccessToken(token);

    // Attach user info to request
    req.user = {
      id: decoded.sub,
      clinicId: decoded.clinicId,
      role: decoded.role,
      permissions: decoded.permissions || [],
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(AppError.unauthorized('Access token expired.', 'TOKEN_EXPIRED'));
    }
    return next(AppError.unauthorized('Invalid access token.', 'INVALID_TOKEN'));
  }
}

module.exports = { authenticate };
