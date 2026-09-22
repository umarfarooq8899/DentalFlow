'use strict';

const mongoose = require('mongoose');

const clinicSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    contact: {
      phone: { type: String },
      email: { type: String, lowercase: true, trim: true },
    },
    address: {
      street: String,
      city: String,
      state: String,
      zip: String,
      country: { type: String, default: 'US' },
    },
    timezone: { type: String, default: 'UTC' },
    currency: { type: String, default: 'USD' },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null },
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended', 'pending'],
      default: 'active',
    },
    // Backwards compatibility fields for Task 1
    phone: { type: String },
    email: { type: String, lowercase: true },
    isActive: { type: Boolean, default: true },
    subscriptionPlan: {
      type: String,
      enum: ['trial', 'basic', 'professional', 'enterprise'],
      default: 'trial',
    },
    subscriptionExpiresAt: { type: Date },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
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

// Keep contact and legacy phone/email & status/isActive in sync
clinicSchema.pre('save', function (next) {
  if (this.phone && (!this.contact || !this.contact.phone)) {
    this.contact = this.contact || {};
    this.contact.phone = this.phone;
  } else if (this.contact && this.contact.phone && !this.phone) {
    this.phone = this.contact.phone;
  }

  if (this.email && (!this.contact || !this.contact.email)) {
    this.contact = this.contact || {};
    this.contact.email = this.email;
  } else if (this.contact && this.contact.email && !this.email) {
    this.email = this.contact.email;
  }

  if (this.isModified('status')) {
    this.isActive = this.status === 'active';
  } else if (this.isModified('isActive')) {
    this.status = this.isActive ? 'active' : 'inactive';
  }

  next();
});


const Clinic = mongoose.model('Clinic', clinicSchema);

module.exports = Clinic;
