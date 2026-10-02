'use strict';

const { Router } = require('express');
const {
  createInvoiceHandler,
  createInvoiceFromTreatmentPlanHandler,
  getInvoiceHandler,
  listInvoicesHandler,
  transitionInvoiceStatusHandler,
  getInvoicePaymentsHandler,
} = require('../../controllers/invoiceController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();
router.use(authenticate, tenantMiddleware);

router.post('/from-treatment-plan/:planId', requirePermission(Permission.BILLING_WRITE), createInvoiceFromTreatmentPlanHandler);
router.post('/', requirePermission(Permission.BILLING_WRITE), createInvoiceHandler);
router.get('/', requirePermission(Permission.BILLING_READ), listInvoicesHandler);
router.get('/:id/payments', requirePermission(Permission.BILLING_READ), getInvoicePaymentsHandler);
router.get('/:id', requirePermission(Permission.BILLING_READ), getInvoiceHandler);
router.patch('/:id/status', requirePermission(Permission.BILLING_WRITE), transitionInvoiceStatusHandler);

module.exports = router;