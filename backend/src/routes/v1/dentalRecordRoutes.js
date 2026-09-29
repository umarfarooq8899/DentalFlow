'use strict';

const { Router } = require('express');
const {
  getDentalRecordHandler,
  updateDentalRecordHandler,
} = require('../../controllers/dentalRecordController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();

router.use(authenticate, tenantMiddleware);

// GET  /api/v1/dental-records/:patientId  — get or create dental record
// PATCH /api/v1/dental-records/:patientId — update dental record
router.get('/:patientId', requirePermission(Permission.CHARTS_READ), getDentalRecordHandler);
router.patch('/:patientId', requirePermission(Permission.CHARTS_WRITE), updateDentalRecordHandler);

module.exports = router;
