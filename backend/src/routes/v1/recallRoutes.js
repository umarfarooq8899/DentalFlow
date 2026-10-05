'use strict';

const { Router } = require('express');
const {
  createRecallHandler,
  listRecallsHandler,
  getRecallHandler,
  updateRecallHandler,
} = require('../../controllers/recallController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();
router.use(authenticate, tenantMiddleware);
router.post('/', requirePermission(Permission.RECALLS_WRITE), createRecallHandler);
router.get('/', requirePermission(Permission.RECALLS_READ), listRecallsHandler);
router.get('/:id', requirePermission(Permission.RECALLS_READ), getRecallHandler);
router.patch('/:id', requirePermission(Permission.RECALLS_WRITE), updateRecallHandler);

module.exports = router;