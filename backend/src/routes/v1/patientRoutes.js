'use strict';

const { Router } = require('express');
const {
  createPatientHandler,
  getPatientHandler,
  updatePatientHandler,
  archivePatientHandler,
  unarchivePatientHandler,
  listPatientsHandler,
  addMedicalAlertHandler,
  removeMedicalAlertHandler,
  verifyMedicalAlertHandler,
} = require('../../controllers/patientController');
const { listPatientConsentsHandler } = require('../../controllers/consentController');
const { listPatientDocumentsHandler } = require('../../controllers/documentController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();

// All routes require authentication + tenant context
router.use(authenticate, tenantMiddleware);

// ─── Patient CRUD ─────────────────────────────────────────────────────────────
router.post('/', requirePermission(Permission.PATIENTS_WRITE), createPatientHandler);
router.get('/', requirePermission(Permission.PATIENTS_READ), listPatientsHandler);
router.get('/:id', requirePermission(Permission.PATIENTS_READ), getPatientHandler);
router.patch('/:id', requirePermission(Permission.PATIENTS_WRITE), updatePatientHandler);

// ─── Archive / Unarchive ──────────────────────────────────────────────────────
router.post('/:id/archive', requirePermission(Permission.PATIENTS_DELETE), archivePatientHandler);
router.post('/:id/unarchive', requirePermission(Permission.PATIENTS_WRITE), unarchivePatientHandler);

// ─── Medical Alerts ───────────────────────────────────────────────────────────
router.post('/:id/medical-alerts', requirePermission(Permission.PATIENTS_WRITE), addMedicalAlertHandler);
router.delete('/:id/medical-alerts/:alertId', requirePermission(Permission.PATIENTS_WRITE), removeMedicalAlertHandler);
router.post('/:id/medical-alerts/:alertId/verify', requirePermission(Permission.CHARTS_WRITE), verifyMedicalAlertHandler);

// ─── Sub-resources (nested under patient) ─────────────────────────────────────
router.get('/:patientId/consents', requirePermission(Permission.PATIENTS_READ), listPatientConsentsHandler);
router.get('/:patientId/documents', requirePermission(Permission.PATIENTS_READ), listPatientDocumentsHandler);

module.exports = router;
