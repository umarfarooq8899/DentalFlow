'use strict';

const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');

/**
 * ConsentTemplate holds versioned consent form templates.
 * Templates are immutable once published — new versions create new documents.
 */
const consentTemplateSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      trim: true,
      // e.g. 'treatment', 'photography', 'data_processing', 'general'
    },
    version: {
      type: Number,
      required: true,
      min: 1,
    },
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    publishedAt: { type: Date, default: Date.now },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
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

consentTemplateSchema.plugin(tenantIsolationPlugin);

// Unique type+version per clinic
consentTemplateSchema.index({ clinicId: 1, type: 1, version: 1 }, { unique: true });
consentTemplateSchema.index({ clinicId: 1, type: 1, isActive: 1 });

const ConsentTemplate = mongoose.model('ConsentTemplate', consentTemplateSchema);

// ─── ConsentForm ───────────────────────────────────────────────────────────

/**
 * ConsentForm records a patient's signed consent against a specific template version.
 * Once signed, a ConsentForm document is IMMUTABLE.
 */
const consentFormSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
    },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ConsentTemplate',
      required: true,
    },
    type: { type: String, required: true, trim: true },
    templateVersion: { type: Number, required: true, min: 1 },
    signedByName: { type: String, required: true, trim: true },
    signedAt: { type: Date, required: true },
    method: {
      type: String,
      required: true,
      enum: ['digital', 'paper', 'verbal'],
    },
    // Ref to a Document object if a physical/scanned copy is stored
    documentRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      default: null,
    },
    // Snapshot of the template content at signing time for archival
    contentSnapshot: { type: String, trim: true },
  },
  {
    timestamps: true,
    // Disable Mongoose built-in save hooks that could allow mutation.
    // Enforced via service layer — no updates allowed.
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

consentFormSchema.plugin(tenantIsolationPlugin);

consentFormSchema.index({ clinicId: 1, patientId: 1, type: 1 });
consentFormSchema.index({ clinicId: 1, patientId: 1 });

const ConsentForm = mongoose.model('ConsentForm', consentFormSchema);

module.exports = { ConsentTemplate, ConsentForm };
