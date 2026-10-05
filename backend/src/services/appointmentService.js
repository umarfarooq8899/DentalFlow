'use strict';

const mongoose = require('mongoose');
const Appointment = require('../models/Appointment');
const DentistProfile = require('../models/DentistProfile');
const Service = require('../models/Service');
const AppError = require('../errors/AppError');
const { getPatient } = require('./patientService');
const { isWithinWorkingHours, utcToLocalDateString } = require('../utils/availability');
const notificationService = require('./notificationService');

// ─── Active statuses (for overlap detection) ──────────────────────────────────

const ACTIVE_STATUSES = ['scheduled', 'confirmed', 'completed'];

async function scheduleReminderSafely(clinicId, appointment) {
  try {
    await notificationService.createAppointmentReminder(clinicId, appointment);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'appointment.reminder_schedule_failed',
      appointmentId: String(appointment._id),
      errorName: error.name,
      errorCode: error.code || null,
    }));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Assert proposedEnd > proposedStart and duration is sensible.
 */
function validateTimeRange(startAt, endAt) {
  if (endAt.getTime() <= startAt.getTime()) {
    throw AppError.badRequest('endAt must be after startAt.', 'INVALID_TIME_RANGE');
  }
  const durationMs = endAt.getTime() - startAt.getTime();
  if (durationMs < 5 * 60 * 1000) {
    throw AppError.badRequest('Appointment duration must be at least 5 minutes.', 'INVALID_DURATION');
  }
}

/**
 * Verify that the dentist belongs to the given clinic and return their profile.
 */
async function resolveDentist(clinicId, dentistId) {
  if (!mongoose.isValidObjectId(dentistId)) {
    throw AppError.notFound('Dentist not found.');
  }
  const dentist = await DentistProfile.findOne({ _id: dentistId, clinicId });
  if (!dentist) throw AppError.notFound('Dentist profile not found in this clinic.');
  return dentist;
}

/**
 * Core overlap detection.
 *
 * Returns true if an ACTIVE appointment exists for the dentist that overlaps
 * [startAt, endAt).
 *
 * Overlap condition: existing.startAt < proposedEnd AND existing.endAt > proposedStart
 * (exclusive endpoint convention: adjacent appointments do NOT overlap)
 *
 * @param {string}  clinicId
 * @param {string}  dentistId
 * @param {Date}    startAt
 * @param {Date}    endAt
 * @param {string?} excludeId – appointment ID to exclude (used during reschedule)
 */
async function detectOverlap(clinicId, dentistId, startAt, endAt, excludeId = null) {
  const filter = {
    clinicId,
    dentistId,
    status: { $in: ACTIVE_STATUSES },
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  };

  if (excludeId) {
    filter._id = { $ne: excludeId };
  }

  const conflict = await Appointment.findOne(filter).lean();
  return conflict;
}

// ─── Create Appointment ───────────────────────────────────────────────────────

async function createAppointment(clinicId, {
  patientId,
  dentistId,
  serviceId,
  startAt: startAtRaw,
  endAt: endAtRaw,
  notes,
  source,
}) {
  if (!mongoose.isValidObjectId(patientId)) throw AppError.badRequest('Invalid patientId.', 'VALIDATION_ERROR');

  const startAt = new Date(startAtRaw);
  const endAt = new Date(endAtRaw);

  if (isNaN(startAt) || isNaN(endAt)) {
    throw AppError.badRequest('startAt and endAt must be valid ISO date strings.', 'VALIDATION_ERROR');
  }

  validateTimeRange(startAt, endAt);

  // Verify patient belongs to clinic
  await getPatient(clinicId, patientId);

  // Verify dentist belongs to clinic
  const dentist = await resolveDentist(clinicId, dentistId);

  // Optionally verify service
  if (serviceId) {
    if (!mongoose.isValidObjectId(serviceId)) throw AppError.badRequest('Invalid serviceId.', 'VALIDATION_ERROR');
    const service = await Service.findOne({ _id: serviceId, clinicId });
    if (!service) throw AppError.notFound('Service not found in this clinic.');
    if (!service.active) throw AppError.badRequest('Service is not active.', 'SERVICE_INACTIVE');
  }

  // Check working hours
  const timezone = dentist.workingHours?.timezone || 'UTC';
  const dateString = utcToLocalDateString(startAt, timezone);
  const workingCheck = isWithinWorkingHours(dentist.workingHours, startAt, endAt, dateString);
  if (!workingCheck.allowed) {
    throw AppError.badRequest(
      workingCheck.reason || 'Appointment is outside dentist working hours.',
      'OUTSIDE_WORKING_HOURS'
    );
  }

  // ── Atomic overlap detection ─────────────────────────────────────────────────
  // Use a MongoDB session transaction to serialize concurrent bookings if supported.
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
  } catch {
    session = null;
  }

  try {
    const conflictQuery = Appointment.findOne({
      clinicId,
      dentistId,
      status: { $in: ACTIVE_STATUSES },
      startAt: { $lt: endAt },
      endAt: { $gt: startAt },
    });
    if (session) conflictQuery.session(session);
    const conflict = await conflictQuery.lean();

    if (conflict) {
      if (session) await session.abortTransaction();
      throw AppError.conflict(
        `Dentist already has an appointment from ${conflict.startAt.toISOString()} to ${conflict.endAt.toISOString()}.`,
        'APPOINTMENT_CONFLICT'
      );
    }

    const createOpts = session ? { session } : {};
    const [appointment] = await Appointment.create(
      [{ clinicId, patientId, dentistId, serviceId: serviceId || null, startAt, endAt, notes: notes || '', source: source || 'phone' }],
      createOpts
    );

    if (session) await session.commitTransaction();
    await scheduleReminderSafely(clinicId, appointment);
    return appointment;
  } catch (err) {
    if (session && session.inTransaction()) await session.abortTransaction();
    throw err;
  } finally {
    if (session) session.endSession();
  }
}

// ─── Get Appointment ──────────────────────────────────────────────────────────

async function getAppointment(clinicId, appointmentId) {
  if (!mongoose.isValidObjectId(appointmentId)) {
    throw AppError.notFound('Appointment not found.');
  }
  const appt = await Appointment.findOne({ _id: appointmentId, clinicId })
    .populate('patientId', 'name phone email patientNo')
    .populate({ path: 'dentistId', populate: { path: 'userId', select: 'name email' } })
    .populate('serviceId', 'name durationMinutes price');

  if (!appt) throw AppError.notFound('Appointment not found.');
  return appt;
}

// ─── Update Appointment ────────────────────────────────────────────────────────

async function updateAppointment(clinicId, appointmentId, updates) {
  const appt = await Appointment.findOne({ _id: appointmentId, clinicId });
  if (!appt) throw AppError.notFound('Appointment not found.');

  const { notes, status, reminderState } = updates;

  // Only allow non-time updates via this method; use reschedule for time changes
  if (notes !== undefined) appt.notes = notes;
  if (status !== undefined) {
    const validTransitions = {
      scheduled: ['confirmed', 'cancelled'],
      confirmed: ['completed', 'cancelled', 'no_show'],
      completed: [],
      cancelled: [],
      no_show: [],
    };
    if (!validTransitions[appt.status]?.includes(status)) {
      throw AppError.badRequest(
        `Cannot transition appointment from '${appt.status}' to '${status}'.`,
        'INVALID_STATUS_TRANSITION'
      );
    }
    if (status === 'cancelled') {
      appt.cancelledAt = new Date();
      appt.cancelReason = updates.cancelReason || null;
    }
    appt.status = status;
  }
  if (reminderState !== undefined) appt.reminderState = reminderState;

  await appt.save();
  return appt;
}

// ─── Reschedule Appointment ────────────────────────────────────────────────────

async function rescheduleAppointment(clinicId, appointmentId, { startAt: startAtRaw, endAt: endAtRaw, notes }) {
  const appt = await Appointment.findOne({ _id: appointmentId, clinicId });
  if (!appt) throw AppError.notFound('Appointment not found.');

  if (['completed', 'cancelled', 'no_show'].includes(appt.status)) {
    throw AppError.badRequest(
      `Cannot reschedule appointment with status '${appt.status}'.`,
      'INVALID_STATUS_TRANSITION'
    );
  }

  const startAt = new Date(startAtRaw);
  const endAt = new Date(endAtRaw);

  if (isNaN(startAt) || isNaN(endAt)) {
    throw AppError.badRequest('startAt and endAt must be valid ISO date strings.', 'VALIDATION_ERROR');
  }

  validateTimeRange(startAt, endAt);

  const dentist = await resolveDentist(clinicId, appt.dentistId.toString());
  const timezone = dentist.workingHours?.timezone || 'UTC';
  const dateString = utcToLocalDateString(startAt, timezone);
  const workingCheck = isWithinWorkingHours(dentist.workingHours, startAt, endAt, dateString);
  if (!workingCheck.allowed) {
    throw AppError.badRequest(
      workingCheck.reason || 'Appointment is outside dentist working hours.',
      'OUTSIDE_WORKING_HOURS'
    );
  }

  // Atomic overlap detection excluding this appointment
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
  } catch {
    session = null;
  }

  try {
    const conflictQuery = Appointment.findOne({
      clinicId,
      dentistId: appt.dentistId,
      status: { $in: ACTIVE_STATUSES },
      startAt: { $lt: endAt },
      endAt: { $gt: startAt },
      _id: { $ne: appointmentId },
    });
    if (session) conflictQuery.session(session);
    const conflict = await conflictQuery.lean();

    if (conflict) {
      if (session) await session.abortTransaction();
      throw AppError.conflict(
        `Dentist already has an appointment from ${conflict.startAt.toISOString()} to ${conflict.endAt.toISOString()}.`,
        'APPOINTMENT_CONFLICT'
      );
    }

    appt.startAt = startAt;
    appt.endAt = endAt;
    if (notes !== undefined) appt.notes = notes;
    appt.status = 'scheduled';
    const saveOpts = session ? { session } : {};
    await appt.save(saveOpts);

    if (session) await session.commitTransaction();
    await scheduleReminderSafely(clinicId, appt);
    return appt;
  } catch (err) {
    if (session && session.inTransaction()) await session.abortTransaction();
    throw err;
  } finally {
    if (session) session.endSession();
  }
}

// ─── Cancel Appointment ────────────────────────────────────────────────────────

async function cancelAppointment(clinicId, appointmentId, { cancelReason } = {}) {
  const appt = await Appointment.findOne({ _id: appointmentId, clinicId });
  if (!appt) throw AppError.notFound('Appointment not found.');

  if (['completed', 'cancelled', 'no_show'].includes(appt.status)) {
    throw AppError.badRequest(
      `Cannot cancel appointment with status '${appt.status}'.`,
      'INVALID_STATUS_TRANSITION'
    );
  }

  appt.status = 'cancelled';
  appt.cancelledAt = new Date();
  appt.cancelReason = cancelReason || null;
  await appt.save();
  return appt;
}

// ─── List / Calendar Queries ───────────────────────────────────────────────────

/**
 * List appointments with optional filters.
 * @param {string} clinicId
 * @param {object} opts
 * @param {string}  [opts.dentistId]
 * @param {string}  [opts.patientId]
 * @param {string}  [opts.status]
 * @param {string}  [opts.from]    – ISO date string (inclusive)
 * @param {string}  [opts.to]      – ISO date string (inclusive, end of day)
 * @param {number}  [opts.page]
 * @param {number}  [opts.limit]
 */
async function listAppointments(clinicId, opts = {}) {
  const { dentistId, patientId, status, from, to, page = 1, limit = 50 } = opts;

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const filter = { clinicId };

  if (dentistId) {
    if (!mongoose.isValidObjectId(dentistId)) throw AppError.badRequest('Invalid dentistId.', 'VALIDATION_ERROR');
    filter.dentistId = dentistId;
  }
  if (patientId) {
    if (!mongoose.isValidObjectId(patientId)) throw AppError.badRequest('Invalid patientId.', 'VALIDATION_ERROR');
    filter.patientId = patientId;
  }
  if (status) filter.status = status;
  if (from || to) {
    filter.startAt = {};
    if (from) filter.startAt.$gte = new Date(from);
    if (to) {
      // Include the entire day by setting to end-of-day
      const toDate = new Date(to);
      toDate.setUTCHours(23, 59, 59, 999);
      filter.startAt.$lte = toDate;
    }
  }

  const [appointments, total] = await Promise.all([
    Appointment.find(filter)
      .populate('patientId', 'name phone email patientNo')
      .populate({ path: 'dentistId', populate: { path: 'userId', select: 'name email' } })
      .populate('serviceId', 'name durationMinutes price')
      .sort({ startAt: 1 })
      .skip(skip)
      .limit(safeLimit),
    Appointment.countDocuments(filter),
  ]);

  return {
    data: appointments,
    pagination: { total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) },
  };
}

module.exports = {
  createAppointment,
  getAppointment,
  updateAppointment,
  rescheduleAppointment,
  cancelAppointment,
  listAppointments,
  detectOverlap,
};
