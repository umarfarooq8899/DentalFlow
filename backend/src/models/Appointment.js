'use strict';

const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');

const appointmentSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
    },
    dentistId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DentistProfile',
      required: true,
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      default: null,
    },
    /**
     * startAt and endAt are stored in UTC.
     * All timezone conversion is performed in the service layer
     * using the dentist's working hours timezone.
     */
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'],
      default: 'scheduled',
    },
    notes: { type: String, trim: true, default: '' },
    source: {
      type: String,
      enum: ['walk_in', 'phone', 'online', 'referral', 'other'],
      default: 'phone',
    },
    reminderState: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'suppressed'],
      default: 'pending',
    },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, trim: true, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
      },
    },
  }
);

appointmentSchema.plugin(tenantIsolationPlugin);

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Required by spec — double-booking detection & availability queries
appointmentSchema.index({ clinicId: 1, dentistId: 1, startAt: 1 });
appointmentSchema.index({ clinicId: 1, patientId: 1, startAt: 1 });

// Status filter (e.g. "show all scheduled for today")
appointmentSchema.index({ clinicId: 1, status: 1 });

// Calendar date-range queries
appointmentSchema.index({ clinicId: 1, startAt: 1, endAt: 1 });

// Dentist+status — for overlap checks filtered to active appointments
appointmentSchema.index({ clinicId: 1, dentistId: 1, status: 1, startAt: 1, endAt: 1 });

const Appointment = mongoose.model('Appointment', appointmentSchema);

module.exports = Appointment;
