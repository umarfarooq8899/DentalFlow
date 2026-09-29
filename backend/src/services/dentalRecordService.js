'use strict';

const mongoose = require('mongoose');
const DentalRecord = require('../models/DentalRecord');
const AppError = require('../errors/AppError');
const { getPatient } = require('./patientService');

/**
 * Get or create a dental record for a patient.
 * One canonical DentalRecord per patient — use append-only DentalChart for history.
 */
async function getOrCreateDentalRecord(clinicId, patientId) {
  if (!mongoose.isValidObjectId(patientId)) {
    throw AppError.notFound('Patient not found.');
  }

  // Ensure patient belongs to clinic
  await getPatient(clinicId, patientId);

  let record = await DentalRecord.findOne({ clinicId, patientId });
  if (!record) {
    record = await DentalRecord.create({ clinicId, patientId });
  }
  return record;
}

/**
 * Get the dental record for a patient.
 */
async function getDentalRecord(clinicId, patientId) {
  if (!mongoose.isValidObjectId(patientId)) {
    throw AppError.notFound('Patient not found.');
  }

  // Verify patient belongs to clinic
  await getPatient(clinicId, patientId);

  const record = await DentalRecord.findOne({ clinicId, patientId });
  if (!record) throw AppError.notFound('Dental record not found for this patient.');
  return record;
}

/**
 * Update dental record fields.
 * Historical integrity is preserved — fields are appended/merged, never silently cleared.
 * If existing content should be replaced, the caller must explicitly provide the full new value.
 *
 * The service appends new notes to the existing notes log (audit trail pattern)
 * so historical content is never silently lost.
 */
async function updateDentalRecord(clinicId, patientId, updates, actorUserId) {
  const record = await getOrCreateDentalRecord(clinicId, patientId);

  const { allergies, medicalHistory, medications, notes } = updates;

  if (allergies !== undefined) record.allergies = allergies;
  if (medicalHistory !== undefined) record.medicalHistory = medicalHistory;
  if (medications !== undefined) record.medications = medications;

  // Append notes with a timestamp + actor prefix to preserve history
  if (notes !== undefined && notes.trim()) {
    const timestamp = new Date().toISOString();
    const actor = actorUserId || 'unknown';
    const entry = `[${timestamp} by ${actor}]\n${notes.trim()}`;
    record.notes = record.notes
      ? `${record.notes}\n\n---\n\n${entry}`
      : entry;
  }

  await record.save();
  return record;
}

/**
 * Add an attachment reference to a dental record.
 * The actual file must be uploaded to S3 separately; this records the metadata.
 */
async function addAttachment(clinicId, patientId, attachmentData) {
  const record = await getOrCreateDentalRecord(clinicId, patientId);
  record.attachments.push(attachmentData);
  await record.save();
  return record;
}

/**
 * Remove an attachment reference from a dental record.
 * Does NOT delete the underlying S3 object — caller is responsible for that.
 */
async function removeAttachment(clinicId, patientId, attachmentId) {
  const record = await getDentalRecord(clinicId, patientId);

  const before = record.attachments.length;
  record.attachments = record.attachments.filter(
    (a) => a._id.toString() !== attachmentId
  );

  if (record.attachments.length === before) {
    throw AppError.notFound('Attachment not found on this dental record.');
  }

  await record.save();
  return record;
}

module.exports = {
  getOrCreateDentalRecord,
  getDentalRecord,
  updateDentalRecord,
  addAttachment,
  removeAttachment,
};
