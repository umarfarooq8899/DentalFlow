'use strict';

const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');

const documentSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
      enum: ['consent', 'xray', 'photo', 'report', 'referral', 'other'],
    },
    storageKey: {
      type: String,
      required: true,
      trim: true,
      // S3 object key — never expose directly to client
    },
    filename: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true, trim: true },
    size: {
      type: Number,
      required: true,
      min: 1,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
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
        // Never expose storageKey in API responses
        delete ret.storageKey;
      },
    },
  }
);

documentSchema.plugin(tenantIsolationPlugin);

documentSchema.index({ clinicId: 1, patientId: 1 });
documentSchema.index({ clinicId: 1, patientId: 1, type: 1 });

const Document = mongoose.model('Document', documentSchema);

module.exports = Document;
