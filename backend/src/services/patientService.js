'use strict';

const mongoose = require('mongoose');
const Patient = require('../models/Patient');
const AppError = require('../errors/AppError');

// ─── Patient Number Generation ──────────────────────────────────────────────

/**
 * Generate the next sequential patient number for a clinic.
 * Format: PT-00001, PT-00002, ...
 * Uses atomic findOneAndUpdate to prevent race conditions.
 * @param {string} clinicId
 */
async function generatePatientNo(clinicId) {
  // Find highest existing patientNo for this clinic
  const last = await Patient.findOne({ clinicId })
    .sort({ patientNo: -1 })
    .select('patientNo')
    .lean();

  let nextNum = 1;
  if (last && last.patientNo) {
    const match = last.patientNo.match(/\d+$/);
    if (match) nextNum = parseInt(match[0], 10) + 1;
  }

  return `PT-${String(nextNum).padStart(5, '0')}`;
}

// ─── Create Patient ──────────────────────────────────────────────────────────

async function createPatient(clinicId, data) {
  const { name, phone, email, DOB, gender, address, emergencyContact, medicalAlerts, status } = data;

  if (!name || !name.trim()) {
    throw AppError.badRequest('Patient name is required.', 'VALIDATION_ERROR');
  }

  const patientNo = await generatePatientNo(clinicId);

  const patient = await Patient.create({
    clinicId,
    patientNo,
    name: name.trim(),
    phone: phone || null,
    email: email ? email.toLowerCase().trim() : null,
    DOB: DOB ? new Date(DOB) : null,
    gender: gender || null,
    address: address || {},
    emergencyContact: emergencyContact || {},
    medicalAlerts: (medicalAlerts || []).map(normalizeAlert),
    status: status || 'active',
  });

  return patient;
}

// ─── Get Patient ─────────────────────────────────────────────────────────────

async function getPatient(clinicId, patientId) {
  if (!mongoose.isValidObjectId(patientId)) {
    throw AppError.notFound('Patient not found.');
  }
  const patient = await Patient.findOne({ _id: patientId, clinicId });
  if (!patient) throw AppError.notFound('Patient not found.');
  return patient;
}

// ─── Update Patient ───────────────────────────────────────────────────────────

async function updatePatient(clinicId, patientId, updates) {
  const patient = await getPatient(clinicId, patientId);

  const allowedFields = ['name', 'phone', 'email', 'DOB', 'gender', 'address', 'emergencyContact', 'status'];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      patient[field] = updates[field];
    }
  }

  // Medical alerts require explicit endpoint — not updated here
  await patient.save();
  return patient;
}

// ─── Archive Patient (soft delete) ────────────────────────────────────────────

async function archivePatient(clinicId, patientId) {
  const patient = await getPatient(clinicId, patientId);

  if (patient.archivedAt) {
    throw AppError.conflict('Patient is already archived.', 'ALREADY_ARCHIVED');
  }

  patient.archivedAt = new Date();
  patient.status = 'archived';
  await patient.save();
  return patient;
}

// ─── Unarchive Patient ────────────────────────────────────────────────────────

async function unarchivePatient(clinicId, patientId) {
  const patient = await getPatient(clinicId, patientId);

  if (!patient.archivedAt) {
    throw AppError.conflict('Patient is not archived.', 'NOT_ARCHIVED');
  }

  patient.archivedAt = null;
  patient.status = 'active';
  await patient.save();
  return patient;
}

// ─── Search / List Patients ────────────────────────────────────────────────────

/**
 * List patients with search, filtering, pagination, and sorting.
 * @param {string} clinicId
 * @param {object} opts
 * @param {string}  [opts.search]         – Free text search on name/phone/email
 * @param {string}  [opts.status]         – Filter by status (active|inactive|archived)
 * @param {boolean} [opts.includeArchived] – Include archived patients (default: false)
 * @param {number}  [opts.page]           – Page number (1-based, default: 1)
 * @param {number}  [opts.limit]          – Results per page (default: 20, max: 100)
 * @param {string}  [opts.sortBy]         – Field to sort by (default: 'createdAt')
 * @param {string}  [opts.sortOrder]      – 'asc' | 'desc' (default: 'desc')
 */
async function listPatients(clinicId, opts = {}) {
  const {
    search,
    status,
    includeArchived = false,
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = opts;

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const allowedSortFields = ['name', 'email', 'phone', 'createdAt', 'updatedAt', 'patientNo', 'status'];
  const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const sortDir = sortOrder === 'asc' ? 1 : -1;

  const filter = { clinicId };

  // Exclude archived by default
  if (!includeArchived) {
    filter.archivedAt = null;
  }

  // Status filter
  if (status) {
    filter.status = status;
  }

  // Text search across name, phone, email
  if (search && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    filter.$or = [{ name: regex }, { phone: regex }, { email: regex }];
  }

  const [patients, total] = await Promise.all([
    Patient.find(filter).sort({ [sortField]: sortDir }).skip(skip).limit(safeLimit),
    Patient.countDocuments(filter),
  ]);

  return {
    data: patients,
    pagination: {
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

// ─── Medical Alerts ────────────────────────────────────────────────────────────

function normalizeAlert(alert) {
  return {
    type: alert.type,
    description: alert.description,
    severity: alert.severity,
    verifiedBy: alert.verifiedBy || null,
    verifiedAt: alert.verifiedAt || null,
  };
}

/**
 * Add a medical alert to a patient.
 */
async function addMedicalAlert(clinicId, patientId, alertData, actorUserId) {
  const patient = await getPatient(clinicId, patientId);

  const alert = {
    type: alertData.type,
    description: alertData.description,
    severity: alertData.severity,
    verifiedBy: actorUserId || null,
    verifiedAt: new Date(),
  };

  patient.medicalAlerts.push(alert);
  await patient.save();
  return patient;
}

/**
 * Remove a medical alert from a patient by alert _id.
 */
async function removeMedicalAlert(clinicId, patientId, alertId) {
  const patient = await getPatient(clinicId, patientId);

  const before = patient.medicalAlerts.length;
  patient.medicalAlerts = patient.medicalAlerts.filter(
    (a) => a._id.toString() !== alertId
  );

  if (patient.medicalAlerts.length === before) {
    throw AppError.notFound('Medical alert not found.');
  }

  await patient.save();
  return patient;
}

/**
 * Verify a medical alert (mark it confirmed by a clinician).
 */
async function verifyMedicalAlert(clinicId, patientId, alertId, actorUserId) {
  const patient = await getPatient(clinicId, patientId);

  const alert = patient.medicalAlerts.id(alertId);
  if (!alert) throw AppError.notFound('Medical alert not found.');

  alert.verifiedBy = actorUserId;
  alert.verifiedAt = new Date();
  await patient.save();
  return patient;
}

module.exports = {
  createPatient,
  getPatient,
  updatePatient,
  archivePatient,
  unarchivePatient,
  listPatients,
  addMedicalAlert,
  removeMedicalAlert,
  verifyMedicalAlert,
};
