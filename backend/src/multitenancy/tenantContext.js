'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

/**
 * Run a callback within a tenant context.
 * @param {string} clinicId - The clinic/tenant ID
 * @param {Function} fn - Callback to run in the tenant context
 */
function runWithTenant(clinicId, fn) {
  return storage.run({ clinicId }, fn);
}

/**
 * Get the current tenant context.
 * @returns {{ clinicId: string } | undefined}
 */
function getTenantContext() {
  return storage.getStore();
}

/**
 * Get the current clinicId.
 * @returns {string | undefined}
 */
function getCurrentClinicId() {
  const store = storage.getStore();
  return store ? store.clinicId : undefined;
}

module.exports = { runWithTenant, getTenantContext, getCurrentClinicId };
