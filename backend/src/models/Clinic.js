'use strict';

const mongoose = require('mongoose');

const clinicSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    address: {
      street: String,
      city: String,
      state: String,
      zip: String,
      country: { type: String, default: 'PK' },
    },
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


const Clinic = mongoose.model('Clinic', clinicSchema);

module.exports = Clinic;
