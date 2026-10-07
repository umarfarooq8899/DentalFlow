'use strict';

const { Router } = require('express');
const {
  scoreLeadHandler,
  suggestReplyHandler,
  reviewAIJobHandler,
  getAIJobHandler,
  listAIJobsHandler,
  previewRedactionHandler,
} = require('../../controllers/aiController');
const { authenticate } = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();

// All AI routes require authentication and tenant context
router.use(authenticate);

// ── Lead Scoring ──────────────────────────────────────────────────────────────
router.post(
  '/leads/:leadId/score',
  requirePermission(Permission.AI_GENERATE, Permission.LEADS_WRITE, Permission.LEADS_READ),
  scoreLeadHandler
);

// ── Suggested Replies ─────────────────────────────────────────────────────────
router.post(
  '/conversations/:conversationId/suggest-reply',
  requirePermission(
    Permission.AI_GENERATE,
    Permission.CONVERSATIONS_WRITE,
    Permission.CONVERSATIONS_READ
  ),
  suggestReplyHandler
);

// ── Human Review Queue ────────────────────────────────────────────────────────
router.post(
  '/jobs/:id/review',
  requirePermission(
    Permission.AI_REVIEW,
    Permission.LEADS_MANAGE,
    Permission.CONVERSATIONS_WRITE
  ),
  reviewAIJobHandler
);

// ── Job Inspection & History ──────────────────────────────────────────────────
router.get(
  '/jobs',
  requirePermission(Permission.AI_GENERATE, Permission.LEADS_READ, Permission.CONVERSATIONS_READ),
  listAIJobsHandler
);

router.get(
  '/jobs/:id',
  requirePermission(Permission.AI_GENERATE, Permission.LEADS_READ, Permission.CONVERSATIONS_READ),
  getAIJobHandler
);

// ── PII Redaction Audit / Preview ─────────────────────────────────────────────
router.post(
  '/redact',
  requirePermission(Permission.AI_GENERATE, Permission.LEADS_READ),
  previewRedactionHandler
);

module.exports = router;
