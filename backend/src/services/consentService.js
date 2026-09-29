'use strict';

const mongoose = require('mongoose');
const { ConsentTemplate, ConsentForm } = require('../models/Consent');
const AppError = require('../errors/AppError');
const { getPatient } = require('./patientService');

// ─── Consent Templates ────────────────────────────────────────────────────────

/**
 * Create a new consent template version.
 * Each type starts at version 1 and increments.
 */
async function createConsentTemplate(clinicId, { type, title, content, publishedBy }) {
  if (!type || !title || !content || !publishedBy) {
    throw AppError.badRequest('type, title, content, and publishedBy are required.', 'VALIDATION_ERROR');
  }

  // Determine the next version for this type in this clinic
  const latest = await ConsentTemplate.findOne({ clinicId, type })
    .sort({ version: -1 })
    .lean();

  const version = latest ? latest.version + 1 : 1;

  // Deactivate all previous versions of this type
  await ConsentTemplate.updateMany(
    { clinicId, type, isActive: true },
    { $set: { isActive: false } }
  );

  const template = await ConsentTemplate.create({
    clinicId,
    type,
    version,
    title,
    content,
    isActive: true,
    publishedAt: new Date(),
    publishedBy,
  });

  return template;
}

/**
 * Get a specific consent template by ID.
 */
async function getConsentTemplate(clinicId, templateId) {
  if (!mongoose.isValidObjectId(templateId)) {
    throw AppError.notFound('Consent template not found.');
  }

  const template = await ConsentTemplate.findOne({ _id: templateId, clinicId });
  if (!template) throw AppError.notFound('Consent template not found.');
  return template;
}

/**
 * List all templates for a clinic (optionally filter by type).
 */
async function listConsentTemplates(clinicId, { type, activeOnly = false } = {}) {
  const filter = { clinicId };
  if (type) filter.type = type;
  if (activeOnly) filter.isActive = true;

  return ConsentTemplate.find(filter).sort({ type: 1, version: -1 });
}

/**
 * Get the active template for a specific type.
 */
async function getActiveTemplate(clinicId, type) {
  const template = await ConsentTemplate.findOne({ clinicId, type, isActive: true });
  if (!template) throw AppError.notFound(`No active consent template found for type '${type}'.`);
  return template;
}

// ─── Consent Forms (Signed) ────────────────────────────────────────────────────

/**
 * Record a signed consent form.
 * ConsentForms are immutable — once created, they cannot be modified.
 * Historical signed consent must remain intact.
 */
async function recordSignedConsent(clinicId, {
  patientId,
  templateId,
  signedByName,
  signedAt,
  method,
  documentRef = null,
}) {
  if (!mongoose.isValidObjectId(patientId)) {
    throw AppError.badRequest('Invalid patientId.', 'VALIDATION_ERROR');
  }
  if (!mongoose.isValidObjectId(templateId)) {
    throw AppError.badRequest('Invalid templateId.', 'VALIDATION_ERROR');
  }
  if (!signedByName || !signedAt || !method) {
    throw AppError.badRequest('signedByName, signedAt, and method are required.', 'VALIDATION_ERROR');
  }

  // Verify patient belongs to clinic
  await getPatient(clinicId, patientId);

  // Fetch template — must belong to this clinic
  const template = await getConsentTemplate(clinicId, templateId);

  // Capture content snapshot for archival immutability
  const consentForm = await ConsentForm.create({
    clinicId,
    patientId,
    templateId: template._id,
    type: template.type,
    templateVersion: template.version,
    signedByName,
    signedAt: new Date(signedAt),
    method,
    documentRef: documentRef || null,
    contentSnapshot: template.content,
  });

  return consentForm;
}

/**
 * Get all signed consent forms for a patient.
 */
async function listPatientConsents(clinicId, patientId, { type } = {}) {
  if (!mongoose.isValidObjectId(patientId)) {
    throw AppError.notFound('Patient not found.');
  }

  // Verify patient belongs to clinic
  await getPatient(clinicId, patientId);

  const filter = { clinicId, patientId };
  if (type) filter.type = type;

  return ConsentForm.find(filter)
    .populate('templateId', 'title type version')
    .sort({ signedAt: -1 });
}

/**
 * Get a specific signed consent form.
 */
async function getConsentForm(clinicId, consentFormId) {
  if (!mongoose.isValidObjectId(consentFormId)) {
    throw AppError.notFound('Consent form not found.');
  }

  const form = await ConsentForm.findOne({ _id: consentFormId, clinicId }).populate(
    'templateId',
    'title type version'
  );

  if (!form) throw AppError.notFound('Consent form not found.');
  return form;
}

module.exports = {
  createConsentTemplate,
  getConsentTemplate,
  listConsentTemplates,
  getActiveTemplate,
  recordSignedConsent,
  listPatientConsents,
  getConsentForm,
};
