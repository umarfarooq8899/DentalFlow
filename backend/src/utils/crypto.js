'use strict';

const crypto = require('crypto');

/**
 * Generate a cryptographically secure random token.
 * @param {number} [bytes=32]
 * @returns {string} hex string
 */
function generateSecureToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = { generateSecureToken };
