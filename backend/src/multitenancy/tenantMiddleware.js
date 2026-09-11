'use strict';

const { runWithTenant } = require('./tenantContext');
const AppError = require('../errors/AppError');

/**
 * Express middleware that extracts clinicId from the authenticated user
 * and sets up the tenant context for the request lifecycle.
 */
function tenantMiddleware(req, res, next) {
  // By this point, authenticate middleware should have set req.user
  if (!req.user || !req.user.clinicId) {
    return next(AppError.unauthorized('Tenant context cannot be established: no clinicId on user.'));
  }

  runWithTenant(req.user.clinicId, () => {
    next();
  });
}

module.exports = { tenantMiddleware };
