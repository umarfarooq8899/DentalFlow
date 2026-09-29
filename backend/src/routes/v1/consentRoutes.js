'use strict';

const { Router } = require('express');
const {
  createConsentTemplateHandler,
  listConsentTemplatesHandler,
  getConsentTemplateHandler,
  recordSignedConsentHandler,
  getConsentFormHandler,
} = require('../../controllers/consentController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();

router.use(authenticate, tenantMiddleware);

// ─── Consent Templates ─────────────────────────────────────────────────────────
router.post('/templates', requirePermission(Permission.CLINIC_MANAGE), createConsentTemplateHandler);
router.get('/templates', requirePermission(Permission.PATIENTS_READ), listConsentTemplatesHandler);
router.get('/templates/:templateId', requirePermission(Permission.PATIENTS_READ), getConsentTemplateHandler);

// ─── Signed Consent Forms ──────────────────────────────────────────────────────
// POST to record a signed consent
router.post('/', requirePermission(Permission.PATIENTS_WRITE), recordSignedConsentHandler);
// GET a specific consent form by ID
router.get('/:consentId', requirePermission(Permission.PATIENTS_READ), getConsentFormHandler);

module.exports = router;
