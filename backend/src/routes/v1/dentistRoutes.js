'use strict';

const { Router } = require('express');
const {
  createOrUpdateProfileHandler,
  getDentistProfileHandler,
  listDentistsHandler,
  updateDentistProfileHandler,
  getDentistAvailabilityHandler,
} = require('../../controllers/dentistController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();

// All dentist routes require authentication + tenant context
router.use(authenticate, tenantMiddleware);

router.post('/', requirePermission(Permission.DENTISTS_MANAGE), createOrUpdateProfileHandler);
router.get('/', requirePermission(Permission.DENTISTS_READ), listDentistsHandler);
router.get('/:id', requirePermission(Permission.DENTISTS_READ), getDentistProfileHandler);
router.patch('/:id', requirePermission(Permission.DENTISTS_MANAGE), updateDentistProfileHandler);
router.get('/:id/availability', requirePermission(Permission.DENTISTS_READ), getDentistAvailabilityHandler);

module.exports = router;
