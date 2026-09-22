'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const env = require('../config/env');

const ROLES = [
  'super_admin',
  'superadmin',
  'clinic_admin',
  'clinic_owner',
  'dentist',
  'hygienist',
  'receptionist',
  'billing_staff',
  'staff',
  'patient',
];

const userSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
      select: false,
      alias: 'passwordHash',
    },
    name: { type: String, trim: true },
    firstName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    role: {
      type: String,
      enum: ROLES,
      required: true,
      default: 'receptionist',
    },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      default: null,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'invited', 'suspended'],
      default: 'active',
    },
    permissions: [{ type: String }],
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.password;
      },
    },
  }
);

// Unique email per clinic (not globally)
userSchema.index({ clinicId: 1, email: 1 }, { unique: true });

userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Hash password and sync name & status before save
userSchema.pre('save', async function (next) {
  // Sync name with firstName/lastName
  if (this.name && (!this.firstName || !this.lastName)) {
    const parts = this.name.trim().split(/\s+/);
    if (!this.firstName) this.firstName = parts[0] || '';
    if (!this.lastName) this.lastName = parts.slice(1).join(' ') || '';
  } else if ((this.firstName || this.lastName) && !this.name) {
    this.name = `${this.firstName || ''} ${this.lastName || ''}`.trim();
  }

  // Sync status and isActive
  if (this.isModified('status')) {
    this.isActive = this.status === 'active';
  } else if (this.isModified('isActive')) {
    this.status = this.isActive ? 'active' : 'inactive';
  }

  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, env.BCRYPT_ROUNDS);
  next();
});

/**
 * Compare candidate password with stored hash.
 * @param {string} candidatePassword
 * @returns {Promise<boolean>}
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);

module.exports = User;
module.exports.ROLES = ROLES;
