'use strict';

const { Router } = require('express');
const {
  recordToothConditionHandler,
  getCurrentDentalChartHandler,
  getDentalChartStateAsOfHandler,
  getToothHistoryHandler,
} = require('../../controllers/dentalChartController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();

router.use(authenticate, tenantMiddleware);

// Record a tooth condition (append-only, updates supersedes chain)
router.post(
  '/chart/:patientId',
  requirePermission(Permission.CHARTS_WRITE),
  recordToothConditionHandler
);

// Get current active dental chart for a patient
router.get(
  '/chart/:patientId',
  requirePermission(Permission.CHARTS_READ),
  getCurrentDentalChartHandler
);

// Historical state reconstruction: get dental chart state as of specified date
router.get(
  '/chart/:patientId/as-of',
  requirePermission(Permission.CHARTS_READ),
  getDentalChartStateAsOfHandler
);

// Complete historical supersedes audit trail for a single tooth
router.get(
  '/chart/:patientId/tooth/:toothNumber/history',
  requirePermission(Permission.CHARTS_READ),
  getToothHistoryHandler
);

module.exports = router;
