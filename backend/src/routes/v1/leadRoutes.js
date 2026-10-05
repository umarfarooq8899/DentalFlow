'use strict';

const { Router } = require('express');
const {
  captureLeadHandler,
  getLeadHandler,
  listLeadsHandler,
  updateLeadHandler,
  assignLeadHandler,
  updateStatusHandler,
  addNoteHandler,
  convertLeadHandler,
} = require('../../controllers/leadController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();

// All routes require authentication + tenant context
router.use(authenticate, tenantMiddleware);

// ─── Lead CRUD ────────────────────────────────────────────────────────────────
router.post('/', requirePermission(Permission.LEADS_WRITE), captureLeadHandler);
router.get('/', requirePermission(Permission.LEADS_READ), listLeadsHandler);
router.get('/:id', requirePermission(Permission.LEADS_READ), getLeadHandler);
router.patch('/:id', requirePermission(Permission.LEADS_WRITE), updateLeadHandler);

// ─── Assignment ───────────────────────────────────────────────────────────────
router.patch('/:id/assign', requirePermission(Permission.LEADS_MANAGE), assignLeadHandler);

// ─── Status Tracking ──────────────────────────────────────────────────────────
router.patch('/:id/status', requirePermission(Permission.LEADS_WRITE), updateStatusHandler);

// ─── Notes ────────────────────────────────────────────────────────────────────
router.post('/:id/notes', requirePermission(Permission.LEADS_WRITE), addNoteHandler);

// ─── Conversion ───────────────────────────────────────────────────────────────
router.post('/:id/convert', requirePermission(Permission.LEADS_MANAGE), convertLeadHandler);

module.exports = router;
