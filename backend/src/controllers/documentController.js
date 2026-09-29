'use strict';

const { z } = require('zod');
const documentService = require('../services/documentService');

// ─── Validation Schemas ────────────────────────────────────────────────────────

const initiateUploadSchema = z.object({
  patientId: z.string().min(1, 'patientId is required'),
  type: z.enum(['consent', 'xray', 'photo', 'report', 'referral', 'other']),
  filename: z.string().trim().min(1, 'filename is required'),
  mimeType: z.string().trim().min(1, 'mimeType is required'),
  size: z.number().int().positive('size must be a positive integer'),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/documents/upload-url
 * Initiate a document upload — returns a pre-signed PUT URL.
 */
async function initiateUploadHandler(req, res, next) {
  try {
    const parsed = initiateUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const result = await documentService.initiateUpload(req.user.clinicId, {
      ...parsed.data,
      uploadedBy: req.user.id,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/documents/:documentId/download-url
 * Get a short-lived pre-signed download URL for an authorized document.
 */
async function getDownloadUrlHandler(req, res, next) {
  try {
    const result = await documentService.getDocumentDownloadUrl(
      req.user.clinicId,
      req.params.documentId
    );
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/documents/:documentId
 * Get document metadata (no URL — use download-url endpoint).
 */
async function getDocumentHandler(req, res, next) {
  try {
    const doc = await documentService.getDocument(req.user.clinicId, req.params.documentId);
    res.status(200).json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/patients/:patientId/documents
 * List all documents for a patient.
 */
async function listPatientDocumentsHandler(req, res, next) {
  try {
    const { type } = req.query;
    const docs = await documentService.listPatientDocuments(
      req.user.clinicId,
      req.params.patientId,
      { type }
    );
    res.status(200).json({ success: true, data: docs });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/v1/documents/:documentId
 * Delete a document and its S3 object.
 */
async function deleteDocumentHandler(req, res, next) {
  try {
    const result = await documentService.deleteDocument(
      req.user.clinicId,
      req.params.documentId,
      req.user.id,
      req.user.role
    );
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  initiateUploadHandler,
  getDownloadUrlHandler,
  getDocumentHandler,
  listPatientDocumentsHandler,
  deleteDocumentHandler,
};
