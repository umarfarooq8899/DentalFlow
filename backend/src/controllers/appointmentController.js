'use strict';

const { z } = require('zod');
const appointmentService = require('../services/appointmentService');

// ─── Validation Schemas ────────────────────────────────────────────────────────

const createSchema = z.object({
  patientId: z.string().min(1, 'patientId is required'),
  dentistId: z.string().min(1, 'dentistId is required'),
  serviceId: z.string().optional().nullable(),
  startAt: z.string().min(1, 'startAt is required'),
  endAt: z.string().min(1, 'endAt is required'),
  notes: z.string().trim().optional(),
  source: z.enum(['walk_in', 'phone', 'online', 'referral', 'other']).optional(),
});

const rescheduleSchema = z.object({
  startAt: z.string().min(1, 'startAt is required'),
  endAt: z.string().min(1, 'endAt is required'),
  notes: z.string().trim().optional(),
});

const updateSchema = z.object({
  notes: z.string().trim().optional(),
  status: z.enum(['confirmed', 'completed', 'cancelled', 'no_show']).optional(),
  cancelReason: z.string().trim().optional(),
  reminderState: z.enum(['pending', 'sent', 'failed', 'suppressed']).optional(),
});

const listQuerySchema = z.object({
  dentistId: z.string().optional(),
  patientId: z.string().optional(),
  status: z.enum(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.string().optional().transform((v) => parseInt(v || '1', 10)),
  limit: z.string().optional().transform((v) => Math.min(parseInt(v || '50', 10), 200)),
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function createAppointmentHandler(req, res, next) {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }
    const appt = await appointmentService.createAppointment(req.user.clinicId, parsed.data);
    res.status(201).json({ success: true, data: appt });
  } catch (err) {
    next(err);
  }
}

async function getAppointmentHandler(req, res, next) {
  try {
    const appt = await appointmentService.getAppointment(req.user.clinicId, req.params.id);
    res.status(200).json({ success: true, data: appt });
  } catch (err) {
    next(err);
  }
}

async function updateAppointmentHandler(req, res, next) {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }
    const appt = await appointmentService.updateAppointment(req.user.clinicId, req.params.id, parsed.data);
    res.status(200).json({ success: true, data: appt });
  } catch (err) {
    next(err);
  }
}

async function rescheduleAppointmentHandler(req, res, next) {
  try {
    const parsed = rescheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }
    const appt = await appointmentService.rescheduleAppointment(req.user.clinicId, req.params.id, parsed.data);
    res.status(200).json({ success: true, data: appt });
  } catch (err) {
    next(err);
  }
}

async function cancelAppointmentHandler(req, res, next) {
  try {
    const appt = await appointmentService.cancelAppointment(
      req.user.clinicId,
      req.params.id,
      { cancelReason: req.body.cancelReason }
    );
    res.status(200).json({ success: true, data: appt });
  } catch (err) {
    next(err);
  }
}

async function listAppointmentsHandler(req, res, next) {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query.', details: parsed.error.flatten() },
      });
    }
    const result = await appointmentService.listAppointments(req.user.clinicId, parsed.data);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createAppointmentHandler,
  getAppointmentHandler,
  updateAppointmentHandler,
  rescheduleAppointmentHandler,
  cancelAppointmentHandler,
  listAppointmentsHandler,
};
