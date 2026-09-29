'use strict';

const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');

const medicalAlertSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ['allergy', 'medication', 'condition', 'other'],
      trim: true,
    },
    description: { type: String, required: true, trim: true },
    severity: {
      type: String,
      required: true,
      enum: ['low', 'medium', 'high', 'critical'],
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    verifiedAt: { type: Date, default: null },
  },
  { _id: true, timestamps: false }
);

const emergencyContactSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    relationship: { type: String, trim: true },
    phone: { type: String, trim: true },
  },
  { _id: false }
);

const addressSchema = new mongoose.Schema(
  {
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    country: { type: String, trim: true },
  },
  { _id: false }
);

const patientSchema = new mongoose.Schema(
  {
    patientNo: {
      type: String,
      required: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: null },
    email: { type: String, trim: true, lowercase: true, default: null },
    DOB: { type: Date, default: null },
    gender: {
      type: String,
      enum: ['male', 'female', 'other', 'prefer_not_to_say', null],
      default: null,
    },
    address: { type: addressSchema, default: () => ({}) },
    emergencyContact: { type: emergencyContactSchema, default: () => ({}) },
    medicalAlerts: { type: [medicalAlertSchema], default: [] },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
    },
    archivedAt: { type: Date, default: null },
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

patientSchema.plugin(tenantIsolationPlugin);

// Unique patient number per clinic
patientSchema.index({ clinicId: 1, patientNo: 1 }, { unique: true });

// Search indexes for name, phone, email
patientSchema.index({ clinicId: 1, name: 1 });
patientSchema.index({ clinicId: 1, phone: 1 });
patientSchema.index({ clinicId: 1, email: 1 });
patientSchema.index({ clinicId: 1, status: 1 });
patientSchema.index({ clinicId: 1, archivedAt: 1 });

const Patient = mongoose.model('Patient', patientSchema);

module.exports = Patient;
