'use strict';

const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');
const {
  ALL_INVOICE_ITEM_TYPES,
  ALL_INVOICE_STATUSES,
  InvoiceStatus,
} = require('@dentalflow/shared');

const invoiceItemSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ALL_INVOICE_ITEM_TYPES, default: 'other' },
    description: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    unitAmount: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    lineTotal: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    treatmentPlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'TreatmentPlan', default: null },
    items: { type: [invoiceItemSchema], required: true, validate: (items) => items.length > 0 },
    subtotal: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    discountAmount: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    taxAmount: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    total: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    paidTotal: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    status: { type: String, enum: ALL_INVOICE_STATUSES, default: InvoiceStatus.DRAFT, index: true },
    idempotencyKey: { type: String, required: true, trim: true },
    requestHash: { type: String, required: true, select: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    issuedAt: { type: Date, default: null },
    voidedAt: { type: Date, default: null },
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

invoiceSchema.plugin(tenantIsolationPlugin);
invoiceSchema.index({ clinicId: 1, idempotencyKey: 1 }, { unique: true });
invoiceSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 });
invoiceSchema.index({ clinicId: 1, status: 1, createdAt: -1 });
invoiceSchema.index({ clinicId: 1, treatmentPlanId: 1 });

module.exports = mongoose.model('Invoice', invoiceSchema);