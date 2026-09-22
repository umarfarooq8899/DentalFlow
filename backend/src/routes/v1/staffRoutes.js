'use strict';

const { Router } = require('express');
const {
  inviteStaffHandler,
  listInvitationsHandler,
  listStaffHandler,
  getStaffHandler,
  updateStaffHandler,
  setStaffStatusHandler,
  acceptInvitationHandler,
} = require('../../controllers/staffController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();

// Public: Accept an invitation (does not need an existing session)
router.post('/invitations/accept', acceptInvitationHandler);

// All other staff routes require authentication + tenant context
router.use(authenticate, tenantMiddleware);

router.post('/invite', requirePermission(Permission.STAFF_MANAGE), inviteStaffHandler);
router.get('/invitations', requirePermission(Permission.STAFF_READ), listInvitationsHandler);
router.get('/', requirePermission(Permission.STAFF_READ), listStaffHandler);
router.get('/:id', requirePermission(Permission.STAFF_READ), getStaffHandler);
router.patch('/:id', requirePermission(Permission.STAFF_MANAGE), updateStaffHandler);
router.patch('/:id/status', requirePermission(Permission.STAFF_MANAGE), setStaffStatusHandler);

module.exports = router;
