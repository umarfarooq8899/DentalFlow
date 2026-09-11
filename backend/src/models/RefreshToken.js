'use strict';

const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true,
    },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByToken: { type: String, default: null },
    userAgent: { type: String },
    ip: { type: String },
  },
  { timestamps: true }
);

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

refreshTokenSchema.methods.isExpired = function () {
  return this.expiresAt < new Date();
};

refreshTokenSchema.methods.isRevoked = function () {
  return this.revokedAt !== null;
};

refreshTokenSchema.methods.isActive = function () {
  return !this.isRevoked() && !this.isExpired();
};

const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);

module.exports = RefreshToken;
