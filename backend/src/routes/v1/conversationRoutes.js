'use strict';

const { Router } = require('express');
const {
  createConversationHandler,
  getConversationHandler,
  listConversationsHandler,
  updateConversationStatusHandler,
  addParticipantHandler,
  removeParticipantHandler,
} = require('../../controllers/conversationController');
const {
  createMessageHandler,
  getMessageHandler,
  listMessagesHandler,
  updateDeliveryStatusHandler,
  deleteMessageHandler,
} = require('../../controllers/messageController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();

// All routes require authentication + tenant context
router.use(authenticate, tenantMiddleware);

// ─── Conversations ────────────────────────────────────────────────────────────
router.post('/', requirePermission(Permission.CONVERSATIONS_WRITE), createConversationHandler);
router.get('/', requirePermission(Permission.CONVERSATIONS_READ), listConversationsHandler);
router.get('/:id', requirePermission(Permission.CONVERSATIONS_READ), getConversationHandler);
router.patch('/:id/status', requirePermission(Permission.CONVERSATIONS_WRITE), updateConversationStatusHandler);

// ─── Participants ─────────────────────────────────────────────────────────────
router.post('/:id/participants', requirePermission(Permission.CONVERSATIONS_WRITE), addParticipantHandler);
router.delete('/:id/participants/:participantId', requirePermission(Permission.CONVERSATIONS_WRITE), removeParticipantHandler);

// ─── Messages (nested under conversations) ────────────────────────────────────
router.post('/:conversationId/messages', requirePermission(Permission.CONVERSATIONS_WRITE), createMessageHandler);
router.get('/:conversationId/messages', requirePermission(Permission.CONVERSATIONS_READ), listMessagesHandler);
router.get('/:conversationId/messages/:id', requirePermission(Permission.CONVERSATIONS_READ), getMessageHandler);
router.patch('/:conversationId/messages/:id/delivery', requirePermission(Permission.CONVERSATIONS_WRITE), updateDeliveryStatusHandler);
router.delete('/:conversationId/messages/:id', requirePermission(Permission.CONVERSATIONS_WRITE), deleteMessageHandler);

module.exports = router;
