'use strict';

const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');
const {
  ALL_TREATMENT_PLAN_STATUSES,
  TreatmentPlanStatus,
} = require('@dentalflow/shared');

const treatmentPlanSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    dentistId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DentistProfile',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    procedures: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TreatmentProcedure',
      },
    ],
    /**
     * Estimated total of the plan in integer minor units (cents). e.g. 50000 = $500.00.
     * Computed from active/completed procedures.
     */
    estimatedTotal: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer. Estimated total must be in minor units (cents).',
      },
    },
    /**
     * Total paid towards this treatment plan in integer minor units (cents).
     */
    paidTotal: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer. Paid total must be in minor units (cents).',
      },
    },
    status: {
      type: String,
      enum: ALL_TREATMENT_PLAN_STATUSES,
      default: TreatmentPlanStatus.DRAFT,
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
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

// Virtual for remaining balance in cents
treatmentPlanSchema.virtual('remainingBalance').get(function () {
  const total = this.estimatedTotal || 0;
  const paid = this.paidTotal || 0;
  return Math.max(0, total - paid);
});

// Apply tenant isolation
treatmentPlanSchema.plugin(tenantIsolationPlugin);

// Compound indexes
treatmentPlanSchema.index({ clinicId: 1, patientId: 1, status: 1 });
treatmentPlanSchema.index({ clinicId: 1, dentistId: 1, status: 1 });
treatmentPlanSchema.index({ clinicId: 1, status: 1 });
treatmentPlanSchema.index({ clinicId: 1, createdAt: -1 });

const TreatmentPlan = mongoose.model('TreatmentPlan', treatmentPlanSchema);

module.exports = TreatmentPlan;
