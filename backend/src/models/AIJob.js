'use strict';

const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');

const aiJobSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true,
    },
    jobType: {
      type: String,
      enum: ['lead_scoring', 'suggested_reply'],
      required: true,
    },
    // The exact text/payload sent to the external provider with all PII replaced by tokens
    redactedInput: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    // Flag indicating whether PII was stripped from the prompt
    piiStripped: {
      type: Boolean,
      default: false,
    },
    redactionCount: {
      type: Number,
      default: 0,
    },
    // Structured response returned from LLM (validated, tokenized)
    output: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // Output after replacing tokens back with internal identities for staff review
    rehydratedOutput: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    model: {
      type: String,
      required: true,
      trim: true,
      default: 'mock-llm-v1',
    },
    provider: {
      type: String,
      required: true,
      trim: true,
      default: 'mock',
    },
    providerRegion: {
      type: String,
      trim: true,
      default: 'us-east-1',
    },
    // Suggested replies MUST remain in 'in_review' / draft state until human approval
    status: {
      type: String,
      enum: ['pending', 'in_review', 'approved', 'rejected', 'completed', 'failed'],
      default: 'in_review',
      index: true,
    },
    // Human reviewer details
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewAction: {
      type: String,
      enum: ['approved', 'rejected', 'modified', null],
      default: null,
    },
    reviewNotes: {
      type: String,
      trim: true,
      default: null,
    },
    // Associated domain entity references (optional)
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      default: null,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      default: null,
    },
    // Execution failure details
    error: {
      code: { type: String, default: null },
      message: { type: String, default: null },
      details: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    // Internal identity mapping for rehydration — strictly internal!
    // Never exposed via toJSON API responses
    identityMap: {
      type: Map,
      of: String,
      default: () => new Map(),
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        ret.id = ret._id ? ret._id.toString() : undefined;
        delete ret._id;
        delete ret.__v;
        // CRITICAL: NEVER leak identityMap in API responses
        delete ret.identityMap;
      },
    },
  }
);

aiJobSchema.plugin(tenantIsolationPlugin);

// Compound indexes
aiJobSchema.index({ clinicId: 1, status: 1, createdAt: -1 });
aiJobSchema.index({ clinicId: 1, jobType: 1, createdAt: -1 });
aiJobSchema.index({ clinicId: 1, leadId: 1 });
aiJobSchema.index({ clinicId: 1, conversationId: 1 });

module.exports = mongoose.model('AIJob', aiJobSchema);
