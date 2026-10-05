'use strict';

const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');

/**
 * Embedded history entry — records every significant state change.
 */
const historyEntrySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: [
        'created',
        'status_changed',
        'assigned',
        'note_added',
        'converted',
        'contact_attempted',
      ],
    },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    fromStatus: { type: String, default: null },
    toStatus: { type: String, default: null },
    note: { type: String, trim: true, maxlength: 1000, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    timestamp: { type: Date, required: true, default: Date.now },
  },
  { _id: true, timestamps: false }
);

const leadSchema = new mongoose.Schema(
  {
    // ── Contact Info ──────────────────────────────────────────────────────
    name: { type: String, required: true, trim: true, maxlength: 200 },
    phone: { type: String, trim: true, maxlength: 50, default: null },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 320,
      default: null,
    },

    // ── Lead Source & Context ─────────────────────────────────────────────
    source: {
      type: String,
      enum: [
        'website',
        'phone',
        'walk_in',
        'referral',
        'social_media',
        'google_ads',
        'other',
      ],
      required: true,
      default: 'other',
    },
    referredBy: { type: String, trim: true, maxlength: 200, default: null },
    interestedIn: { type: String, trim: true, maxlength: 500, default: null },
    notes: { type: String, trim: true, maxlength: 2000, default: null },

    // ── Status Workflow ───────────────────────────────────────────────────
    status: {
      type: String,
      enum: [
        'new',
        'contacted',
        'qualified',
        'appointment_scheduled',
        'converted',
        'lost',
      ],
      required: true,
      default: 'new',
    },

    // ── Assignment ────────────────────────────────────────────────────────
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assignedAt: { type: Date, default: null },

    // ── Lead Conversion ───────────────────────────────────────────────────
    convertedAt: { type: Date, default: null },
    convertedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      default: null,
    },

    // ── Capture Metadata ──────────────────────────────────────────────────
    capturedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    ipAddress: { type: String, trim: true, maxlength: 50, default: null },

    // ── Audit Trail ───────────────────────────────────────────────────────
    history: { type: [historyEntrySchema], default: [] },
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

leadSchema.plugin(tenantIsolationPlugin);

// ── Indexes ───────────────────────────────────────────────────────────────────
leadSchema.index({ clinicId: 1, status: 1, createdAt: -1 });
leadSchema.index({ clinicId: 1, assignedTo: 1, status: 1 });
leadSchema.index({ clinicId: 1, email: 1 });
leadSchema.index({ clinicId: 1, phone: 1 });
leadSchema.index({ clinicId: 1, patientId: 1 });
leadSchema.index({ clinicId: 1, source: 1 });
leadSchema.index({ clinicId: 1, createdAt: -1 });

module.exports = mongoose.model('Lead', leadSchema);
