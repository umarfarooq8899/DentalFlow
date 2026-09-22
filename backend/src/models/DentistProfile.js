'use strict';

const mongoose = require('mongoose');

const workingPeriodSchema = new mongoose.Schema(
  {
    startTime: { type: String, required: true }, // "09:00" in 24h HH:mm format
    endTime: { type: String, required: true },   // "17:00" in 24h HH:mm format
  },
  { _id: false }
);

const dailyScheduleSchema = new mongoose.Schema(
  {
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 }, // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    dayName: { type: String }, // "Monday"
    isWorkingDay: { type: Boolean, default: true },
    workingPeriods: [workingPeriodSchema],
  },
  { _id: false }
);

const dayOffSchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // "YYYY-MM-DD"
    reason: { type: String, trim: true },
  },
  { _id: false }
);

const workingHoursSchema = new mongoose.Schema(
  {
    timezone: { type: String, default: 'UTC' },
    weeklySchedule: [dailyScheduleSchema],
    daysOff: [dayOffSchema],
  },
  { _id: false }
);

const dentistProfileSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    specialty: [
      {
        type: String,
        trim: true,
      },
    ],
    licenseInfo: {
      licenseNumber: { type: String, trim: true },
      issuingAuthority: { type: String, trim: true },
      expirationDate: { type: Date },
    },
    bio: {
      type: String,
      trim: true,
    },
    workingHours: {
      type: workingHoursSchema,
      default: () => ({
        timezone: 'UTC',
        weeklySchedule: [
          { dayOfWeek: 1, dayName: 'Monday', isWorkingDay: true, workingPeriods: [{ startTime: '09:00', endTime: '17:00' }] },
          { dayOfWeek: 2, dayName: 'Tuesday', isWorkingDay: true, workingPeriods: [{ startTime: '09:00', endTime: '17:00' }] },
          { dayOfWeek: 3, dayName: 'Wednesday', isWorkingDay: true, workingPeriods: [{ startTime: '09:00', endTime: '17:00' }] },
          { dayOfWeek: 4, dayName: 'Thursday', isWorkingDay: true, workingPeriods: [{ startTime: '09:00', endTime: '17:00' }] },
          { dayOfWeek: 5, dayName: 'Friday', isWorkingDay: true, workingPeriods: [{ startTime: '09:00', endTime: '17:00' }] },
          { dayOfWeek: 6, dayName: 'Saturday', isWorkingDay: false, workingPeriods: [] },
          { dayOfWeek: 0, dayName: 'Sunday', isWorkingDay: false, workingPeriods: [] },
        ],
        daysOff: [],
      }),
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

dentistProfileSchema.index({ clinicId: 1, userId: 1 }, { unique: true });

const DentistProfile = mongoose.model('DentistProfile', dentistProfileSchema);

module.exports = DentistProfile;
