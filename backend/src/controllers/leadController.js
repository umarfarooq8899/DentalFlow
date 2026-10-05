'use strict';

const { z } = require('zod');
const leadService = require('../services/leadService');

// ─── Validation Schemas ────────────────────────────────────────────────────────

const captureLeadSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  phone: z.string().trim().max(50).optional().nullable(),
  email: z.string().email().max(320).optional().nullable(),
  source: z
    .enum(['website', 'phone', 'walk_in', 'referral', 'social_media', 'google_ads', 'other'])
    .optional(),
  referredBy: z.string().trim().max(200).optional().nullable(),
  interestedIn: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

const updateLeadSchema = captureLeadSchema.partial();

const listQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z
    .enum(['new', 'contacted', 'qualified', 'appointment_scheduled', 'converted', 'lost'])
    .optional(),
  source: z
    .enum(['website', 'phone', 'walk_in', 'referral', 'social_media', 'google_ads', 'other'])
    .optional(),
  assignedTo: z.string().optional(),
  page: z
    .string()
    .optional()
    .transform((v) => parseInt(v || '1', 10)),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(parseInt(v || '20', 10), 100)),
  sortBy: z
    .enum(['name', 'status', 'source', 'createdAt', 'assignedAt', 'convertedAt'])
    .optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

const assignSchema = z.object({
  assignedTo: z.string().nullable(),
});

const statusSchema = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'appointment_scheduled', 'lost']),
  note: z.string().trim().max(1000).optional().nullable(),
});

const noteSchema = z.object({
  note: z.string().trim().min(1).max(1000),
});

const convertSchema = z.object({
  existingPatientId: z.string().optional().nullable(),
  patientData: z
    .object({
      name: z.string().trim().optional(),
      phone: z.string().trim().optional().nullable(),
      email: z.string().email().optional().nullable(),
      DOB: z.string().optional().nullable(),
      gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional().nullable(),
      address: z.object({
        street: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        postalCode: z.string().optional(),
        country: z.string().optional(),
      }).optional(),
    })
    .optional()
    .nullable(),
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function captureLeadHandler(req, res, next) {
  try {
    const parsed = captureLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const lead = await leadService.captureLead(
      req.user.clinicId,
      { ...parsed.data, ipAddress: req.ip },
      req.user.id
    );
    res.status(201).json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
}

async function getLeadHandler(req, res, next) {
  try {
    const lead = await leadService.getLead(req.user.clinicId, req.params.id);
    res.status(200).json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
}

async function listLeadsHandler(req, res, next) {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters.', details: parsed.error.flatten() },
      });
    }

    const result = await leadService.listLeads(req.user.clinicId, parsed.data);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function updateLeadHandler(req, res, next) {
  try {
    const parsed = updateLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const lead = await leadService.updateLead(
      req.user.clinicId,
      req.params.id,
      parsed.data,
      req.user.id
    );
    res.status(200).json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
}

async function assignLeadHandler(req, res, next) {
  try {
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const lead = await leadService.assignLead(
      req.user.clinicId,
      req.params.id,
      parsed.data.assignedTo,
      req.user.id
    );
    res.status(200).json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
}

async function updateStatusHandler(req, res, next) {
  try {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const lead = await leadService.updateLeadStatus(
      req.user.clinicId,
      req.params.id,
      parsed.data.status,
      req.user.id,
      parsed.data.note
    );
    res.status(200).json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
}

async function addNoteHandler(req, res, next) {
  try {
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const lead = await leadService.addLeadNote(
      req.user.clinicId,
      req.params.id,
      parsed.data.note,
      req.user.id
    );
    res.status(201).json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
}

async function convertLeadHandler(req, res, next) {
  try {
    const parsed = convertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const result = await leadService.convertLeadToPatient(
      req.user.clinicId,
      req.params.id,
      {
        existingPatientId: parsed.data.existingPatientId || null,
        patientData: parsed.data.patientData || null,
      },
      req.user.id
    );

    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  captureLeadHandler,
  getLeadHandler,
  listLeadsHandler,
  updateLeadHandler,
  assignLeadHandler,
  updateStatusHandler,
  addNoteHandler,
  convertLeadHandler,
};
