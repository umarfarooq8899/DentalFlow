'use strict';

const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');
const { ALL_PAYMENT_METHODS, PaymentMethod } = require('@dentalflow/shared');

const paymentAllocationSchema = new mongoose.Schema(
  {
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    amount: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    treatmentPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TreatmentPlan',
      default: null,
      index: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      default: null,
      index: true,
    },
    /**
     * Payment amount in integer minor units (cents). e.g. 5000 = $50.00.
     */
    amount: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer. Payment amount must be in minor units (cents).',
      },
    },
    allocations: { type: [paymentAllocationSchema], default: [] },
    status: { type: String, enum: ['recorded'], default: 'recorded', immutable: true },
    method: {
      type: String,
      enum: ALL_PAYMENT_METHODS,
      default: PaymentMethod.CASH,
    },
    reference: {
      type: String,
      trim: true,
      default: '',
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
    },
    requestHash: {
      type: String,
      default: null,
      select: false,
    },
    paidAt: {
      type: Date,
      default: Date.now,
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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
        delete ret.idempotencyKey;
        delete ret.requestHash;
      },
    },
  }
);

// Apply tenant isolation
paymentSchema.plugin(tenantIsolationPlugin);

// Unique idempotency key per clinic
paymentSchema.index({ clinicId: 1, idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ clinicId: 1, patientId: 1, paidAt: -1 });
paymentSchema.index({ clinicId: 1, treatmentPlanId: 1 });

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;
