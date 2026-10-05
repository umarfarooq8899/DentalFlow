'use strict';

const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: String, required: true, trim: true, maxlength: 320 },
    recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', default: null },
    channel: { type: String, enum: ['email', 'sms', 'in_app'], required: true },
    subject: { type: String, trim: true, maxlength: 200, default: '' },
    message: { type: String, required: true, maxlength: 5000 },
    status: {
      type: String,
      enum: ['queued', 'processing', 'sent', 'failed', 'cancelled'],
      default: 'queued',
      index: true,
    },
    scheduledAt: { type: Date, required: true, default: Date.now },
    sentAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    error: {
      code: { type: String, default: null },
      message: { type: String, default: null },
      at: { type: Date, default: null },
    },
    dedupeKey: { type: String, required: true, trim: true, maxlength: 250 },
    requestHash: { type: String, required: true, select: false },
    relatedResourceType: { type: String, enum: ['appointment', 'recall', null], default: null },
    relatedResourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.dedupeKey;
        delete ret.requestHash;
      },
    },
  }
);

notificationSchema.plugin(tenantIsolationPlugin);
notificationSchema.index({ clinicId: 1, dedupeKey: 1 }, { unique: true });
notificationSchema.index({ clinicId: 1, status: 1, scheduledAt: 1 });
notificationSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 });
notificationSchema.index({ clinicId: 1, relatedResourceType: 1, relatedResourceId: 1 });

module.exports = mongoose.model('Notification', notificationSchema);