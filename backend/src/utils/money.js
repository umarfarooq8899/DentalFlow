'use strict';

/**
 * Money Utility — Guarantees financial calculations do not suffer from
 * IEEE 754 floating-point drift.
 * All amounts are represented and stored as exact integer minor units (cents).
 * e.g., $10.50 -> 1050 cents.
 */

/**
 * Safely parse any input into an exact integer number of cents.
 * Handles integer cents directly, dollar decimals (e.g. 10.50), or string amounts.
 * @param {number|string} amount
 * @returns {number} integer cents
 */
function toCents(amount) {
  if (amount === undefined || amount === null || amount === '') {
    return 0;
  }

  if (typeof amount === 'string') {
    const cleaned = amount.trim().replace(/^[$,\s]+/, '');
    if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
      throw new TypeError(`Invalid monetary string format: "${amount}"`);
    }
    const isNegative = cleaned.startsWith('-');
    const absVal = isNegative ? cleaned.slice(1) : cleaned;
    const [wholeStr, fracStr = ''] = absVal.split('.');
    const whole = parseInt(wholeStr, 10);
    const frac = parseInt((fracStr + '00').slice(0, 2), 10);
    const total = whole * 100 + frac;
    return isNegative ? -total : total;
  }

  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) {
      throw new TypeError(`Amount must be a finite number: ${amount}`);
    }
    // If it's already an exact integer, assume it's in cents if specified or round cleanly
    return Math.round(amount);
  }

  throw new TypeError(`Unsupported monetary value type: ${typeof amount}`);
}

/**
 * Convert a dollar decimal (e.g. 19.99) to exact integer cents (1999).
 * Parses via string conversion to avoid 19.99 * 100 = 1998.9999999999998 floating point bugs.
 * @param {number|string} dollars
 * @returns {number}
 */
function dollarsToCents(dollars) {
  if (typeof dollars === 'number') {
    return toCents(dollars.toFixed(2));
  }
  return toCents(dollars);
}

/**
 * Convert integer cents to a 2-decimal place string (e.g. 1999 -> "19.99").
 * @param {number} cents
 * @returns {string}
 */
function centsToDecimalString(cents) {
  assertValidCents(cents);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainingCents = abs % 100;
  return `${sign}${dollars}.${remainingCents.toString().padStart(2, '0')}`;
}

/**
 * Convert integer cents to a standard float representation only when explicitly needed for display.
 * @param {number} cents
 * @returns {number}
 */
function centsToDollars(cents) {
  assertValidCents(cents);
  return Number(centsToDecimalString(cents));
}

/**
 * Verify that the value is an integer.
 * @param {number} cents
 */
function assertValidCents(cents) {
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents)) {
    throw new TypeError(`Expected a safe integer for cents, received: ${cents}`);
  }
}

/**
 * Add an arbitrary list of integer cent values without float drift.
 * @param  {...number} values
 * @returns {number}
 */
function addCents(...values) {
  return values.reduce((accum, val) => {
    const c = toCents(val);
    assertValidCents(c);
    const result = accum + c;
    assertValidCents(result);
    return result;
  }, 0);
}

/**
 * Subtract b from a (in cents).
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function subtractCents(a, b) {
  const cA = toCents(a);
  const cB = toCents(b);
  assertValidCents(cA);
  assertValidCents(cB);
  const result = cA - cB;
  assertValidCents(result);
  return result;
}

/**
 * Multiply integer cents by a ratio or quantity, rounding to nearest integer cent.
 * @param {number} cents
 * @param {number} factor
 * @returns {number}
 */
function multiplyCents(cents, factor) {
  assertValidCents(cents);
  if (typeof factor !== 'number' || !Number.isFinite(factor)) {
    throw new TypeError(`Factor must be a finite number: ${factor}`);
  }
  return Math.round(cents * factor);
}

/**
 * Format integer cents as a currency string (e.g. 15000 -> "$150.00").
 * @param {number} cents
 * @param {string} currency
 * @returns {string}
 */
function formatCents(cents, currency = 'USD') {
  assertValidCents(cents);
  const decimalStr = centsToDecimalString(cents);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(Number(decimalStr));
}

module.exports = {
  toCents,
  dollarsToCents,
  centsToDollars,
  centsToDecimalString,
  assertValidCents,
  addCents,
  subtractCents,
  multiplyCents,
  formatCents,
};
