'use strict';

const roleService = require('../services/roleService');

async function listRolesHandler(req, res, next) {
  try {
    const roles = await roleService.listRoles(req.user.clinicId);
    res.status(200).json({
      success: true,
      data: roles,
    });
  } catch (err) {
    next(err);
  }
}

async function createRoleHandler(req, res, next) {
  try {
    const role = await roleService.createRole(req.user.clinicId, req.body);
    res.status(201).json({
      success: true,
      data: role,
    });
  } catch (err) {
    next(err);
  }
}

async function getRoleHandler(req, res, next) {
  try {
    const role = await roleService.getRoleById(req.user.clinicId, req.params.id);
    res.status(200).json({
      success: true,
      data: role,
    });
  } catch (err) {
    next(err);
  }
}

async function updateRoleHandler(req, res, next) {
  try {
    const role = await roleService.updateRole(req.user.clinicId, req.params.id, req.body);
    res.status(200).json({
      success: true,
      data: role,
    });
  } catch (err) {
    next(err);
  }
}

async function deleteRoleHandler(req, res, next) {
  try {
    const result = await roleService.deleteRole(req.user.clinicId, req.params.id);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listRolesHandler,
  createRoleHandler,
  getRoleHandler,
  updateRoleHandler,
  deleteRoleHandler,
};
