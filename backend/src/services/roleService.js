'use strict';

const Role = require('../models/Role');
const User = require('../models/User');
const AppError = require('../errors/AppError');

/**
 * List roles accessible to the clinic (clinic-specific + platform-level roles).
 */
async function listRoles(clinicId) {
  const roles = await Role.find({
    $or: [{ clinicId }, { clinicId: null }],
  }).sort({ isSystemRole: -1, name: 1 });
  return roles;
}

/**
 * Create a custom role for the clinic.
 */
async function createRole(clinicId, { name, permissions = [] }) {
  if (!name || !name.trim()) {
    throw AppError.badRequest('Role name is required.');
  }

  const existingRole = await Role.findOne({ clinicId, name: name.trim() });
  if (existingRole) {
    throw AppError.conflict(`Role '${name}' already exists in this clinic.`);
  }

  const role = await Role.create({
    clinicId,
    name: name.trim(),
    permissions,
    isSystemRole: false,
  });

  return role;
}

/**
 * Get role by ID within clinic scope.
 */
async function getRoleById(clinicId, roleId) {
  const role = await Role.findOne({
    _id: roleId,
    $or: [{ clinicId }, { clinicId: null }],
  });

  if (!role) {
    throw AppError.notFound('Role not found.');
  }
  return role;
}

/**
 * Update a custom role. System roles cannot be modified.
 */
async function updateRole(clinicId, roleId, { name, permissions }) {
  const role = await Role.findOne({ _id: roleId, clinicId });
  if (!role) {
    throw AppError.notFound('Role not found or cannot be modified.');
  }

  if (role.isSystemRole) {
    throw AppError.forbidden('System roles cannot be modified.');
  }

  if (name && name.trim() !== role.name) {
    const existingRole = await Role.findOne({ clinicId, name: name.trim(), _id: { $ne: roleId } });
    if (existingRole) {
      throw AppError.conflict(`Role '${name}' already exists in this clinic.`);
    }
    role.name = name.trim();
  }

  if (permissions !== undefined) {
    role.permissions = permissions;
  }

  await role.save();
  return role;
}

/**
 * Delete a custom role. System roles and roles currently in use cannot be deleted.
 */
async function deleteRole(clinicId, roleId) {
  const role = await Role.findOne({ _id: roleId, clinicId });
  if (!role) {
    throw AppError.notFound('Role not found.');
  }

  if (role.isSystemRole) {
    throw AppError.forbidden('System roles cannot be deleted.');
  }

  // Check if any user currently uses this role
  const userWithRole = await User.findOne({ clinicId, roleId });
  if (userWithRole) {
    throw AppError.badRequest('Cannot delete role: one or more staff members are assigned to this role.');
  }

  await Role.deleteOne({ _id: roleId });
  return { success: true, message: 'Role deleted successfully.' };
}

module.exports = {
  listRoles,
  createRole,
  getRoleById,
  updateRole,
  deleteRole,
};
