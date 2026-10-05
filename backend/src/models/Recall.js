'use strict';

const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');

const recallSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
    dueAt: { type: Date, required: true },
    lastContactedAt: { type: Date, default: null },
    nextActionAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['scheduled', 'due', 'contacted', 'completed', 'cancelled'],
      default: 'scheduled',
      index: true,
    },
    reason: { type: String, trim: true, maxlength: 500, default: '' },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 255 },
    requestHash: { type: String, required: true, select: false },
    contactSequence: { type: Number, default: 0, min: 0 },
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

recallSchema.plugin(tenantIsolationPlugin);
recallSchema.index({ clinicId: 1, idempotencyKey: 1 }, { unique: true });
recallSchema.index({ clinicId: 1, patientId: 1, status: 1, dueAt: 1 });
recallSchema.index({ clinicId: 1, status: 1, nextActionAt: 1 });

module.exports = mongoose.model('Recall', recallSchema);