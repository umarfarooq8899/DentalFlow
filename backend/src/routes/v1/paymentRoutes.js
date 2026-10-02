'use strict';

const { Router } = require('express');
const { createPaymentHandler, listPaymentsHandler } = require('../../controllers/paymentController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();
router.use(authenticate, tenantMiddleware);
router.post('/', requirePermission(Permission.BILLING_WRITE), createPaymentHandler);
router.get('/', requirePermission(Permission.BILLING_READ), listPaymentsHandler);

module.exports = router;