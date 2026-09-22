'use strict';

const { Router } = require('express');
const {
  createServiceHandler,
  getServiceHandler,
  updateServiceHandler,
  archiveServiceHandler,
  listServicesHandler,
} = require('../../controllers/serviceController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();

// All service routes require authentication + tenant context
router.use(authenticate, tenantMiddleware);

router.post('/', requirePermission(Permission.SERVICES_MANAGE), createServiceHandler);
router.get('/', requirePermission(Permission.SERVICES_READ), listServicesHandler);
router.get('/:id', requirePermission(Permission.SERVICES_READ), getServiceHandler);
router.patch('/:id', requirePermission(Permission.SERVICES_MANAGE), updateServiceHandler);
// DELETE performs soft-archive, not hard-delete
router.delete('/:id', requirePermission(Permission.SERVICES_MANAGE), archiveServiceHandler);

module.exports = router;
