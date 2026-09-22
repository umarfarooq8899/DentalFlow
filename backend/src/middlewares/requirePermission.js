'use strict';

const AppError = require('../errors/AppError');

const { ROLE_PERMISSIONS } = require('@dentalflow/shared');

/**
 * Role hierarchy — higher index = more privileged.
 */
const ROLE_RANKS = {
  patient: 1,
  staff: 2,
  billing_staff: 2,
  receptionist: 3,
  hygienist: 4,
  dentist: 5,
  clinic_admin: 10,
  clinic_owner: 10,
  super_admin: 99,
  superadmin: 99,
};

/**
 * Middleware factory: require user to have at least the given role.
 * @param {string} requiredRole
 */
function requireRole(requiredRole) {
  return (req, res, next) => {
    if (!req.user) {
      return next(AppError.unauthorized());
    }

    const userRank = ROLE_RANKS[req.user.role] || 0;
    const requiredRank = ROLE_RANKS[requiredRole] || 0;

    if (userRank === 0 || requiredRank === 0) {
      return next(AppError.forbidden('Unknown role.'));
    }

    if (userRank < requiredRank) {
      return next(
        AppError.forbidden(`This action requires the '${requiredRole}' role or higher.`)
      );
    }

    next();
  };
}

/**
 * Middleware factory: require user to have a specific permission string.
 * Supports wildcard '*', clinic_admin/clinic_owner/super_admin pass-through,
 * and role-based default permissions from shared module.
 * @param {string} permission
 */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return next(AppError.unauthorized());
    }

    const role = req.user.role;
    // Admins have universal access
    if (['clinic_admin', 'clinic_owner', 'super_admin', 'superadmin'].includes(role)) {
      return next();
    }

    const userPermissions = req.user.permissions || [];
    if (userPermissions.includes('*') || userPermissions.includes(permission)) {
      return next();
    }

    // Check inherited role permissions
    const inherited = ROLE_PERMISSIONS[role] || [];
    if (inherited.includes(permission)) {
      return next();
    }

    return next(
      AppError.forbidden(`Missing required permission: '${permission}'.`)
    );
  };
}

module.exports = { requireRole, requirePermission };
