'use strict';

/**
 * PII Redaction Engine
 *
 * Detects and replaces sensitive PII (names, phone numbers, email addresses, street addresses)
 * with deterministic anonymous tokens (e.g. [NAME_001], [PHONE_001], [EMAIL_001], [ADDRESS_001]).
 * Maintains an internal token-to-original mapping that NEVER leaves the internal perimeter.
 */

// Regex patterns for automatic detection
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// International and standard phone numbers: handles +1-555-123-4567, 03001234567, (555) 123-4567, +44 20 7946 0958, etc.
const PHONE_REGEX = /(?:\+?\d{1,4}[-.\s]?)?(?:\(?\d{2,5}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,5}\b/g;

// Street addresses: e.g. "123 Main St, Suite 400", "742 Evergreen Terrace", "45 Park Avenue, NY 10001"
const ADDRESS_REGEX = /\b\d{1,5}\s+[A-Za-z0-9\s.,'-]+?\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Court|Ct\.?|Way|Parkway|Pkwy\.?|Suite|Ste\.?|Apt\.?|Apartment|Terrace|Plaza)\b(?:[,\s]+[A-Za-z\s]+(?:,\s*[A-Z]{2}\s*\d{4,6})?)?/gi;

// Common honorific / name prefix patterns (e.g., "Mr. John Smith", "Dr. Emily Stone")
const TITLE_NAME_REGEX = /\b(?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;

class PIIRedactor {
  constructor() {
    this.counters = {
      name: 0,
      phone: 0,
      email: 0,
      address: 0,
    };
    this.tokenToOriginal = new Map();
    this.originalToToken = new Map();
  }

  _getOrCreateToken(type, originalValue) {
    const trimmed = originalValue.trim();
    if (this.originalToToken.has(trimmed.toLowerCase())) {
      return this.originalToToken.get(trimmed.toLowerCase());
    }

    this.counters[type] = (this.counters[type] || 0) + 1;
    const num = String(this.counters[type]).padStart(3, '0');
    const token = `[${type.toUpperCase()}_${num}]`;

    this.tokenToOriginal.set(token, trimmed);
    this.originalToToken.set(trimmed.toLowerCase(), token);
    return token;
  }

  /**
   * Redacts PII from text using both known entities and heuristic patterns.
   *
   * @param {string} text - The input text containing potential PII.
   * @param {object} [knownEntities] - Known explicit entities from domain models:
   *   { names?: string[], phones?: string[], emails?: string[], addresses?: string[] }
   * @returns {{ redactedText: string, tokens: Record<string, string>, piiStripped: boolean, count: number }}
   */
  redact(text, knownEntities = {}) {
    if (typeof text !== 'string' || !text.trim()) {
      return {
        redactedText: text || '',
        tokens: Object.fromEntries(this.tokenToOriginal),
        piiStripped: false,
        count: 0,
      };
    }

    let result = text;
    let initialCount = this.tokenToOriginal.size;

    // 1. Redact known explicit entities first (highest accuracy)
    if (Array.isArray(knownEntities.emails)) {
      for (const email of knownEntities.emails) {
        if (email && typeof email === 'string' && email.trim()) {
          const token = this._getOrCreateToken('email', email);
          result = result.replace(new RegExp(escapeRegExp(email.trim()), 'gi'), token);
        }
      }
    }

    if (Array.isArray(knownEntities.phones)) {
      for (const phone of knownEntities.phones) {
        if (phone && typeof phone === 'string' && phone.trim()) {
          const token = this._getOrCreateToken('phone', phone);
          result = result.replace(new RegExp(escapeRegExp(phone.trim()), 'gi'), token);
        }
      }
    }

    if (Array.isArray(knownEntities.addresses)) {
      for (const address of knownEntities.addresses) {
        if (address && typeof address === 'string' && address.trim()) {
          const token = this._getOrCreateToken('address', address);
          result = result.replace(new RegExp(escapeRegExp(address.trim()), 'gi'), token);
        }
      }
    }

    if (Array.isArray(knownEntities.names)) {
      for (const name of knownEntities.names) {
        if (name && typeof name === 'string' && name.trim()) {
          const token = this._getOrCreateToken('name', name);
          result = result.replace(new RegExp(escapeRegExp(name.trim()), 'gi'), token);
        }
      }
    }

    // 2. Pattern-based redaction: Emails
    result = result.replace(EMAIL_REGEX, (match) => {
      return this._getOrCreateToken('email', match);
    });

    // 3. Pattern-based redaction: Addresses
    result = result.replace(ADDRESS_REGEX, (match) => {
      // Avoid replacing tokens that were already inserted
      if (match.startsWith('[') && match.endsWith(']')) return match;
      return this._getOrCreateToken('address', match);
    });

    // 4. Pattern-based redaction: Phone numbers
    result = result.replace(PHONE_REGEX, (match) => {
      // Filter out small digit sequences (like years or simple numbers)
      const digitsOnly = match.replace(/\D/g, '');
      if (digitsOnly.length < 7 || digitsOnly.length > 15) return match;
      // Skip if inside an existing token like [PHONE_001]
      if (match.startsWith('[') || match.endsWith(']')) return match;
      return this._getOrCreateToken('phone', match);
    });

    // 5. Pattern-based redaction: Title-prefixed names (Dr. Smith, Mr. John)
    result = result.replace(TITLE_NAME_REGEX, (fullMatch, namePart) => {
      if (fullMatch.startsWith('[')) return fullMatch;
      const token = this._getOrCreateToken('name', fullMatch);
      return token;
    });

    const tokensObj = Object.fromEntries(this.tokenToOriginal);
    const count = this.tokenToOriginal.size;
    const piiStripped = count > initialCount || count > 0;

    return {
      redactedText: result,
      tokens: tokensObj,
      piiStripped,
      count,
    };
  }

  /**
   * Rehydrates a text or deep object by replacing tokens with original values.
   *
   * @param {any} target - String, array, or object to rehydrate.
   * @param {Record<string, string>|Map<string, string>} [customTokens] - Token map to use.
   * @returns {any}
   */
  static rehydrate(target, customTokens = {}) {
    const tokenMap = customTokens instanceof Map ? customTokens : new Map(Object.entries(customTokens || {}));

    if (tokenMap.size === 0) {
      return target;
    }

    function rehydrateString(str) {
      if (typeof str !== 'string') return str;
      let output = str;
      for (const [token, original] of tokenMap.entries()) {
        output = output.split(token).join(original);
      }
      return output;
    }

    function walk(node) {
      if (node === null || node === undefined) return node;
      if (typeof node === 'string') return rehydrateString(node);
      if (Array.isArray(node)) return node.map(walk);
      if (typeof node === 'object') {
        const copy = {};
        for (const [k, v] of Object.entries(node)) {
          copy[k] = walk(v);
        }
        return copy;
      }
      return node;
    }

    return walk(target);
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  PIIRedactor,
  rehydrate: PIIRedactor.rehydrate,
};
