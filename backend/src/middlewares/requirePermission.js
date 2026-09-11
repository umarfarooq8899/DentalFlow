'use strict';

const AppError = require('../errors/AppError');

/**
 * Role hierarchy — higher index = more privileged.
 */
const ROLE_HIERARCHY = ['patient', 'receptionist', 'dentist', 'clinic_admin', 'super_admin'];

/**
 * Middleware factory: require user to have at least the given role.
 * @param {string} requiredRole
 */
function requireRole(requiredRole) {
  return (req, res, next) => {
    if (!req.user) {
      return next(AppError.unauthorized());
    }

    const userRoleIndex = ROLE_HIERARCHY.indexOf(req.user.role);
    const requiredRoleIndex = ROLE_HIERARCHY.indexOf(requiredRole);

    if (userRoleIndex === -1 || requiredRoleIndex === -1) {
      return next(AppError.forbidden('Unknown role.'));
    }

    if (userRoleIndex < requiredRoleIndex) {
      return next(
        AppError.forbidden(`This action requires the '${requiredRole}' role or higher.`)
      );
    }

    next();
  };
}

/**
 * Middleware factory: require user to have a specific permission string.
 * @param {string} permission
 */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return next(AppError.unauthorized());
    }

    const userPermissions = req.user.permissions || [];

    if (!userPermissions.includes(permission)) {
      return next(
        AppError.forbidden(`Missing required permission: '${permission}'.`)
      );
    }

    next();
  };
}

module.exports = { requireRole, requirePermission };
