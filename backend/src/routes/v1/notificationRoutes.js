'use strict';

const { Router } = require('express');
const {
  createNotificationHandler,
  listNotificationsHandler,
  getNotificationHandler,
} = require('../../controllers/notificationController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();
router.use(authenticate, tenantMiddleware);
router.post('/', requirePermission(Permission.NOTIFICATIONS_WRITE), createNotificationHandler);
router.get('/', requirePermission(Permission.NOTIFICATIONS_READ), listNotificationsHandler);
router.get('/:id', requirePermission(Permission.NOTIFICATIONS_READ), getNotificationHandler);

module.exports = router;