'use strict';

const { Router } = require('express');
const {
  createTreatmentPlanHandler,
  getTreatmentPlanHandler,
  listTreatmentPlansHandler,
  updateTreatmentPlanHandler,
  addProcedureHandler,
  updateProcedureHandler,
  completeProcedureHandler,
  recordPaymentHandler,
  getPaymentsHandler,
} = require('../../controllers/treatmentPlanController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();

router.use(authenticate, tenantMiddleware);

// Treatment plans CRUD & listing
router.post(
  '/',
  requirePermission(Permission.CHARTS_WRITE),
  createTreatmentPlanHandler
);

router.get(
  '/',
  requirePermission(Permission.CHARTS_READ, Permission.BILLING_READ),
  listTreatmentPlansHandler
);

router.get(
  '/:id',
  requirePermission(Permission.CHARTS_READ, Permission.BILLING_READ),
  getTreatmentPlanHandler
);

router.patch(
  '/:id',
  requirePermission(Permission.CHARTS_WRITE),
  updateTreatmentPlanHandler
);

// Procedures management within treatment plan
router.post(
  '/:id/procedures',
  requirePermission(Permission.CHARTS_WRITE),
  addProcedureHandler
);

router.patch(
  '/:id/procedures/:procedureId',
  requirePermission(Permission.CHARTS_WRITE),
  updateProcedureHandler
);

router.post(
  '/:id/procedures/:procedureId/complete',
  requirePermission(Permission.CHARTS_WRITE),
  completeProcedureHandler
);

// Payments & balances for treatment plan
router.post(
  '/:id/payments',
  requirePermission(Permission.BILLING_WRITE, Permission.CHARTS_WRITE),
  recordPaymentHandler
);

router.get(
  '/:id/payments',
  requirePermission(Permission.BILLING_READ, Permission.CHARTS_READ),
  getPaymentsHandler
);

module.exports = router;
