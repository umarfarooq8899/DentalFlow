'use strict';

const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');

const attachmentSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true, trim: true },
    storageKey: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true, trim: true },
    size: { type: Number, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const dentalRecordSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
    },
    allergies: { type: String, trim: true, default: '' },
    medicalHistory: { type: String, trim: true, default: '' },
    medications: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    attachments: { type: [attachmentSchema], default: [] },
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

dentalRecordSchema.plugin(tenantIsolationPlugin);

dentalRecordSchema.index({ clinicId: 1, patientId: 1 });

const DentalRecord = mongoose.model('DentalRecord', dentalRecordSchema);

module.exports = DentalRecord;
