'use strict';

const mongoose = require('mongoose');
const crypto = require('crypto');
const path = require('path');
const Document = require('../models/Document');
const AppError = require('../errors/AppError');
const { getPatient } = require('./patientService');
const s3 = require('../integrations/s3Storage');

// ─── Configuration ─────────────────────────────────────────────────────────────

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'image/dicom',
  'application/dicom',
]);

const ALLOWED_DOCUMENT_TYPES = new Set(['consent', 'xray', 'photo', 'report', 'referral', 'other']);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function validateMimeType(mimeType) {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw AppError.badRequest(
      `Unsupported file type: ${mimeType}. Allowed: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
      'INVALID_MIME_TYPE'
    );
  }
}

function validateFileSize(size) {
  if (!size || size < 1) {
    throw AppError.badRequest('File size must be greater than 0.', 'INVALID_FILE_SIZE');
  }
  if (size > MAX_FILE_SIZE_BYTES) {
    throw AppError.badRequest(
      `File exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB.`,
      'FILE_TOO_LARGE'
    );
  }
}

function validateDocumentType(type) {
  if (!ALLOWED_DOCUMENT_TYPES.has(type)) {
    throw AppError.badRequest(
      `Invalid document type: ${type}. Allowed: ${[...ALLOWED_DOCUMENT_TYPES].join(', ')}`,
      'INVALID_DOCUMENT_TYPE'
    );
  }
}

// ─── Initiate Upload ───────────────────────────────────────────────────────────

/**
 * Initiate a document upload.
 * 1. Validates mime type, file size, and document type.
 * 2. Generates a private S3 object key.
 * 3. Issues a short-lived pre-signed upload URL.
 * 4. Returns the upload URL and a pending document metadata record.
 *
 * The client MUST call confirmUpload() after successfully uploading to S3.
 */
async function initiateUpload(clinicId, {
  patientId,
  uploadedBy,
  type,
  filename,
  mimeType,
  size,
  metadata = {},
}) {
  // Validate inputs
  if (!mongoose.isValidObjectId(patientId)) {
    throw AppError.badRequest('Invalid patientId.', 'VALIDATION_ERROR');
  }

  validateDocumentType(type);
  validateMimeType(mimeType);
  validateFileSize(size);

  // Verify patient belongs to clinic
  await getPatient(clinicId, patientId);

  // Build a UUID-prefixed private S3 key to prevent guessing
  const ext = path.extname(filename) || '';
  const uniqueName = `${crypto.randomUUID()}${ext}`;
  const storageKey = s3.buildObjectKey(clinicId, patientId, type, uniqueName);

  // Issue pre-signed PUT URL
  const uploadUrl = await s3.generateUploadUrl(storageKey, mimeType);

  // Create a pending document record (confirmed once upload succeeds)
  const doc = await Document.create({
    clinicId,
    patientId,
    uploadedBy,
    type,
    storageKey,
    filename,
    mimeType,
    size,
    metadata,
  });

  return {
    documentId: doc._id,
    uploadUrl,
    // storageKey is deliberately excluded from the response
    expiresInSeconds: parseInt(process.env.S3_SIGNED_URL_EXPIRES_SECONDS || '900', 10),
  };
}

// ─── Get Download URL ──────────────────────────────────────────────────────────

/**
 * Generate a short-lived pre-signed download URL for a document.
 * Validates that the caller belongs to the same clinic and the document exists.
 */
async function getDocumentDownloadUrl(clinicId, documentId) {
  const doc = await getDocument(clinicId, documentId);

  const url = await s3.generateDownloadUrl(doc.storageKey);

  return {
    documentId: doc._id,
    filename: doc.filename,
    mimeType: doc.mimeType,
    downloadUrl: url,
    expiresInSeconds: parseInt(process.env.S3_SIGNED_URL_EXPIRES_SECONDS || '900', 10),
  };
}

// ─── Get Document ──────────────────────────────────────────────────────────────

async function getDocument(clinicId, documentId) {
  if (!mongoose.isValidObjectId(documentId)) {
    throw AppError.notFound('Document not found.');
  }

  const doc = await Document.findOne({ _id: documentId, clinicId });
  if (!doc) throw AppError.notFound('Document not found.');
  return doc;
}

// ─── List Documents ────────────────────────────────────────────────────────────

async function listPatientDocuments(clinicId, patientId, { type } = {}) {
  if (!mongoose.isValidObjectId(patientId)) {
    throw AppError.notFound('Patient not found.');
  }

  // Verify patient belongs to clinic
  await getPatient(clinicId, patientId);

  const filter = { clinicId, patientId };
  if (type) {
    validateDocumentType(type);
    filter.type = type;
  }

  // storageKey is excluded via schema toJSON transform
  return Document.find(filter).sort({ createdAt: -1 });
}

// ─── Delete Document ────────────────────────────────────────────────────────────

/**
 * Delete a document record and its associated S3 object.
 * Only the uploading user or clinic admin may delete.
 */
async function deleteDocument(clinicId, documentId, actorUserId, actorRole) {
  const doc = await getDocument(clinicId, documentId);

  const isAdmin = ['clinic_admin', 'clinic_owner', 'super_admin', 'superadmin'].includes(actorRole);
  if (!isAdmin && doc.uploadedBy.toString() !== actorUserId.toString()) {
    throw AppError.forbidden('You are not authorized to delete this document.');
  }

  // Delete from S3
  await s3.deleteObject(doc.storageKey);

  // Delete metadata record
  await Document.deleteOne({ _id: doc._id, clinicId });

  return { deleted: true, documentId };
}

module.exports = {
  initiateUpload,
  getDocumentDownloadUrl,
  getDocument,
  listPatientDocuments,
  deleteDocument,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
};
