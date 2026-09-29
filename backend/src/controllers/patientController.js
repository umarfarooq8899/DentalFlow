'use strict';

const { z } = require('zod');
const patientService = require('../services/patientService');

// ─── Validation Schemas ────────────────────────────────────────────────────────

const addressSchema = z.object({
  street: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  country: z.string().trim().optional(),
}).optional();

const emergencyContactSchema = z.object({
  name: z.string().trim().optional(),
  relationship: z.string().trim().optional(),
  phone: z.string().trim().optional(),
}).optional();

const medicalAlertSchema = z.object({
  type: z.enum(['allergy', 'medication', 'condition', 'other']),
  description: z.string().trim().min(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
});

const createPatientSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  phone: z.string().trim().optional().nullable(),
  email: z.string().email().optional().nullable(),
  DOB: z.string().optional().nullable(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional().nullable(),
  address: addressSchema,
  emergencyContact: emergencyContactSchema,
  medicalAlerts: z.array(medicalAlertSchema).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const updatePatientSchema = createPatientSchema.partial();

const listQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  includeArchived: z.string().optional().transform((v) => v === 'true'),
  page: z.string().optional().transform((v) => parseInt(v || '1', 10)),
  limit: z.string().optional().transform((v) => Math.min(parseInt(v || '20', 10), 100)),
  sortBy: z.enum(['name', 'email', 'phone', 'createdAt', 'updatedAt', 'patientNo', 'status']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function createPatientHandler(req, res, next) {
  try {
    const parsed = createPatientSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const patient = await patientService.createPatient(req.user.clinicId, parsed.data);
    res.status(201).json({ success: true, data: patient });
  } catch (err) {
    next(err);
  }
}

async function getPatientHandler(req, res, next) {
  try {
    const patient = await patientService.getPatient(req.user.clinicId, req.params.id);
    res.status(200).json({ success: true, data: patient });
  } catch (err) {
    next(err);
  }
}

async function updatePatientHandler(req, res, next) {
  try {
    const parsed = updatePatientSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const patient = await patientService.updatePatient(req.user.clinicId, req.params.id, parsed.data);
    res.status(200).json({ success: true, data: patient });
  } catch (err) {
    next(err);
  }
}

async function archivePatientHandler(req, res, next) {
  try {
    const patient = await patientService.archivePatient(req.user.clinicId, req.params.id);
    res.status(200).json({ success: true, data: patient });
  } catch (err) {
    next(err);
  }
}

async function unarchivePatientHandler(req, res, next) {
  try {
    const patient = await patientService.unarchivePatient(req.user.clinicId, req.params.id);
    res.status(200).json({ success: true, data: patient });
  } catch (err) {
    next(err);
  }
}

async function listPatientsHandler(req, res, next) {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters.', details: parsed.error.flatten() },
      });
    }

    const result = await patientService.listPatients(req.user.clinicId, parsed.data);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

// ─── Medical Alert Handlers ────────────────────────────────────────────────────

async function addMedicalAlertHandler(req, res, next) {
  try {
    const parsed = medicalAlertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid alert data.', details: parsed.error.flatten() },
      });
    }

    const patient = await patientService.addMedicalAlert(
      req.user.clinicId,
      req.params.id,
      parsed.data,
      req.user.id
    );
    res.status(201).json({ success: true, data: patient });
  } catch (err) {
    next(err);
  }
}

async function removeMedicalAlertHandler(req, res, next) {
  try {
    const patient = await patientService.removeMedicalAlert(
      req.user.clinicId,
      req.params.id,
      req.params.alertId
    );
    res.status(200).json({ success: true, data: patient });
  } catch (err) {
    next(err);
  }
}

async function verifyMedicalAlertHandler(req, res, next) {
  try {
    const patient = await patientService.verifyMedicalAlert(
      req.user.clinicId,
      req.params.id,
      req.params.alertId,
      req.user.id
    );
    res.status(200).json({ success: true, data: patient });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createPatientHandler,
  getPatientHandler,
  updatePatientHandler,
  archivePatientHandler,
  unarchivePatientHandler,
  listPatientsHandler,
  addMedicalAlertHandler,
  removeMedicalAlertHandler,
  verifyMedicalAlertHandler,
};
