'use strict';

const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');
const {
  isValidToothNumber,
  ALL_TREATMENT_PROCEDURE_STATUSES,
  TreatmentProcedureStatus,
} = require('@dentalflow/shared');

const treatmentProcedureSchema = new mongoose.Schema(
  {
    treatmentPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TreatmentPlan',
      required: true,
      index: true,
    },
    toothNumber: {
      type: Number,
      default: null,
      validate: {
        validator: function (val) {
          if (val === null || val === undefined) return true;
          return isValidToothNumber(val);
        },
        message: (props) => `${props.value} is not a valid tooth number (must be 1-32 Universal Numbering System).`,
      },
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      default: null,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    /**
     * Exact price in integer minor units (cents). e.g. 15000 = $150.00.
     * Prevents JavaScript IEEE 754 floating-point errors.
     */
    price: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer. Monetary amounts must be in minor units (cents).',
      },
    },
    status: {
      type: String,
      enum: ALL_TREATMENT_PROCEDURE_STATUSES,
      default: TreatmentProcedureStatus.PLANNED,
    },
    scheduledAppointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment',
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
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

// Apply tenant isolation
treatmentProcedureSchema.plugin(tenantIsolationPlugin);

// Compound indexes
treatmentProcedureSchema.index({ clinicId: 1, treatmentPlanId: 1 });
treatmentProcedureSchema.index({ clinicId: 1, treatmentPlanId: 1, status: 1 });
treatmentProcedureSchema.index({ clinicId: 1, toothNumber: 1 });

const TreatmentProcedure = mongoose.model('TreatmentProcedure', treatmentProcedureSchema);

module.exports = TreatmentProcedure;
