'use strict';

const DentistProfile = require('../models/DentistProfile');
const User = require('../models/User');
const AppError = require('../errors/AppError');

/**
 * Create or update a dentist profile for a clinic user.
 */
async function createOrUpdateProfile(clinicId, { userId, specialty, licenseInfo, bio, workingHours }) {
  if (!userId) {
    throw AppError.badRequest('User ID is required.');
  }

  // Verify user exists and belongs to this clinic
  const user = await User.findOne({ _id: userId, clinicId });
  if (!user) {
    throw AppError.notFound('User not found in this clinic.');
  }

  // Ensure user has dentist role or update it
  if (user.role !== 'dentist' && user.role !== 'clinic_admin' && user.role !== 'clinic_owner') {
    user.role = 'dentist';
    await user.save();
  }

  let profile = await DentistProfile.findOne({ clinicId, userId });
  if (profile) {
    if (specialty !== undefined) profile.specialty = Array.isArray(specialty) ? specialty : [specialty];
    if (licenseInfo !== undefined) profile.licenseInfo = licenseInfo;
    if (bio !== undefined) profile.bio = bio;
    if (workingHours !== undefined) profile.workingHours = workingHours;
    await profile.save();
  } else {
    profile = await DentistProfile.create({
      clinicId,
      userId,
      specialty: Array.isArray(specialty) ? specialty : specialty ? [specialty] : ['General Dentistry'],
      licenseInfo: licenseInfo || {},
      bio: bio || '',
      workingHours: workingHours || undefined,
    });
  }

  return DentistProfile.findById(profile._id).populate('userId', 'name email role status');
}

/**
 * Get dentist profile by ID or user ID within clinic.
 */
async function getDentistProfile(clinicId, profileOrUserId) {
  let profile = await DentistProfile.findOne({
    clinicId,
    $or: [{ _id: profileOrUserId }, { userId: profileOrUserId }],
  }).populate('userId', 'name email role status lastLoginAt');

  if (!profile) {
    throw AppError.notFound('Dentist profile not found in this clinic.');
  }
  return profile;
}

/**
 * List all dentists in clinic.
 */
async function listDentists(clinicId) {
  return DentistProfile.find({ clinicId })
    .populate('userId', 'name email role status')
    .sort({ createdAt: -1 });
}

/**
 * Update dentist profile by profile ID within clinic.
 */
async function updateDentistProfile(clinicId, profileId, { specialty, licenseInfo, bio, workingHours }) {
  const profile = await DentistProfile.findOne({ _id: profileId, clinicId });
  if (!profile) {
    throw AppError.notFound('Dentist profile not found.');
  }

  if (specialty !== undefined) profile.specialty = Array.isArray(specialty) ? specialty : [specialty];
  if (licenseInfo !== undefined) profile.licenseInfo = licenseInfo;
  if (bio !== undefined) profile.bio = bio;
  if (workingHours !== undefined) profile.workingHours = workingHours;

  await profile.save();
  return DentistProfile.findById(profile._id).populate('userId', 'name email role status');
}

/**
 * Compute availability for a dentist on a specific date (YYYY-MM-DD).
 * Evaluates timezone, days off, and weekly working periods without ambiguous time conversions.
 */
async function getDentistAvailability(clinicId, profileOrUserId, dateString) {
  if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw AppError.badRequest("Invalid date format. Expected 'YYYY-MM-DD'.");
  }

  const profile = await getDentistProfile(clinicId, profileOrUserId);
  const workingHours = profile.workingHours || {};
  const timezone = workingHours.timezone || 'UTC';
  const daysOff = workingHours.daysOff || [];
  const weeklySchedule = workingHours.weeklySchedule || [];

  // Check days off
  const dayOffMatch = daysOff.find((d) => d.date === dateString);
  if (dayOffMatch) {
    return {
      date: dateString,
      timezone,
      isAvailable: false,
      reason: dayOffMatch.reason || 'Scheduled day off',
      workingPeriods: [],
    };
  }

  // Parse YYYY-MM-DD to determine day of week
  const [year, month, day] = dateString.split('-').map((v) => parseInt(v, 10));
  // Month is 0-indexed in JS Date
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = parsedDate.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

  const daySchedule = weeklySchedule.find((s) => s.dayOfWeek === dayOfWeek);

  if (!daySchedule || !daySchedule.isWorkingDay || !daySchedule.workingPeriods || daySchedule.workingPeriods.length === 0) {
    return {
      date: dateString,
      timezone,
      isAvailable: false,
      dayOfWeek,
      dayName: daySchedule ? daySchedule.dayName : undefined,
      reason: 'Non-working day',
      workingPeriods: [],
    };
  }

  return {
    date: dateString,
    timezone,
    isAvailable: true,
    dayOfWeek,
    dayName: daySchedule.dayName,
    workingPeriods: daySchedule.workingPeriods,
  };
}

module.exports = {
  createOrUpdateProfile,
  getDentistProfile,
  listDentists,
  updateDentistProfile,
  getDentistAvailability,
};
