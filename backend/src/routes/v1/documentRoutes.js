'use strict';

const { Router } = require('express');
const {
  initiateUploadHandler,
  getDownloadUrlHandler,
  getDocumentHandler,
  deleteDocumentHandler,
} = require('../../controllers/documentController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();

router.use(authenticate, tenantMiddleware);

// POST /api/v1/documents/upload-url — initiate upload (returns signed PUT URL)
router.post('/upload-url', requirePermission(Permission.PATIENTS_WRITE), initiateUploadHandler);

// GET  /api/v1/documents/:documentId — get document metadata
router.get('/:documentId', requirePermission(Permission.PATIENTS_READ), getDocumentHandler);

// GET  /api/v1/documents/:documentId/download-url — get signed download URL
router.get('/:documentId/download-url', requirePermission(Permission.PATIENTS_READ), getDownloadUrlHandler);

// DELETE /api/v1/documents/:documentId — delete document
router.delete('/:documentId', requirePermission(Permission.PATIENTS_WRITE), deleteDocumentHandler);

module.exports = router;
