'use strict';

const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      default: null, // null = platform-level system role
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    permissions: [
      {
        type: String,
        trim: true,
      },
    ],
    isSystemRole: {
      type: Boolean,
      default: false,
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

// Unique role name per clinic (and per platform when clinicId is null)
roleSchema.index({ clinicId: 1, name: 1 }, { unique: true });

const Role = mongoose.model('Role', roleSchema);

module.exports = Role;
