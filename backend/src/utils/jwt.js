'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Sign a JWT access token.
 * @param {object} payload
 * @returns {string}
 */
function signAccessToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    algorithm: 'HS256',
  });
}

/**
 * Verify a JWT access token.
 * @param {string} token
 * @returns {object} decoded payload
 */
function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
}

/**
 * Sign a JWT refresh token.
 * @param {object} payload
 * @returns {string}
 */
function signRefreshToken(payload) {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    algorithm: 'HS256',
  });
}

/**
 * Verify a JWT refresh token.
 * @param {string} token
 * @returns {object} decoded payload
 */
function verifyRefreshToken(token) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
};
