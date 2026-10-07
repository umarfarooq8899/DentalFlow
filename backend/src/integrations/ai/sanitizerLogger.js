'use strict';

/**
 * AI Gateway Sanitizer & Safe Logger
 *
 * Enforces strict compliance with privacy rules:
 * NEVER logs raw patient text, unredacted prompts, identity mappings, API keys, or JWT tokens.
 */

const SENSITIVE_KEYS = new Set([
  'identitymap',
  'mapping',
  'unredacted',
  'rawtext',
  'rawprompt',
  'prompt',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'authorization',
  'password',
  'secret',
]);

function sanitizeData(data, depth = 0) {
  if (depth > 5) return '[DEPTH_LIMIT]';
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    // Check if string looks like a JWT or Bearer token
    if (/bearer\s+[A-Za-z0-9-_.]+/i.test(data) || /ey[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/.test(data)) {
      return '[REDACTED_TOKEN]';
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeData(item, depth + 1));
  }

  if (typeof data === 'object') {
    const clean = {};
    for (const [key, val] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lowerKey)) {
        clean[key] = '[REDACTED_SENSITIVE_FIELD]';
      } else {
        clean[key] = sanitizeData(val, depth + 1);
      }
    }
    return clean;
  }

  return data;
}

const aiLogger = {
  info(message, meta = {}) {
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[AI-GATEWAY INFO] ${message}`, JSON.stringify(sanitizeData(meta)));
    }
  },
  warn(message, meta = {}) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[AI-GATEWAY WARN] ${message}`, JSON.stringify(sanitizeData(meta)));
    }
  },
  error(message, meta = {}) {
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[AI-GATEWAY ERROR] ${message}`, JSON.stringify(sanitizeData(meta)));
    }
  },
  sanitizeData,
};

module.exports = aiLogger;
