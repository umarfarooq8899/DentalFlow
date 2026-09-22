'use strict';

const mongoose = require('mongoose');

const staffInvitationSchema = new mongoose.Schema(
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
    name: {
      type: String,
      trim: true,
    },
    role: {
      type: String,
      required: true,
      default: 'receptionist',
    },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      default: null,
    },
    token: {
      type: String,
      required: true,
      unique: true,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'expired', 'cancelled'],
      default: 'pending',
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    acceptedAt: {
      type: Date,
      default: null,
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
      },
    },
  }
);

staffInvitationSchema.index({ clinicId: 1, email: 1 });
staffInvitationSchema.index({ token: 1 });

/**
 * Check if the invitation is active (pending and not expired).
 */
staffInvitationSchema.methods.isValid = function () {
  return this.status === 'pending' && this.expiresAt > new Date();
};

const StaffInvitation = mongoose.model('StaffInvitation', staffInvitationSchema);

module.exports = StaffInvitation;
