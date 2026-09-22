'use strict';

const { Router } = require('express');
const {
  listRolesHandler,
  createRoleHandler,
  getRoleHandler,
  updateRoleHandler,
  deleteRoleHandler,
} = require('../../controllers/roleController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();

// All role routes require authentication + tenant context
router.use(authenticate, tenantMiddleware);

router.get('/', requirePermission(Permission.ROLES_READ), listRolesHandler);
router.post('/', requirePermission(Permission.ROLES_MANAGE), createRoleHandler);
router.get('/:id', requirePermission(Permission.ROLES_READ), getRoleHandler);
router.patch('/:id', requirePermission(Permission.ROLES_MANAGE), updateRoleHandler);
router.delete('/:id', requirePermission(Permission.ROLES_MANAGE), deleteRoleHandler);

module.exports = router;
