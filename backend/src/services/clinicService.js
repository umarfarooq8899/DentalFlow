'use strict';

const mongoose = require('mongoose');
const Clinic = require('../models/Clinic');
const User = require('../models/User');
const Role = require('../models/Role');
const RefreshToken = require('../models/RefreshToken');
const AppError = require('../errors/AppError');
const { signAccessToken, signRefreshToken } = require('../utils/jwt');
const { generateSecureToken } = require('../utils/crypto');
const env = require('../config/env');
const { ROLE_PERMISSIONS, UserRole } = require('@dentalflow/shared');

function parseExpiryToMs(expiry) {
  const unit = expiry.slice(-1);
  const value = parseInt(expiry.slice(0, -1), 10);
  const map = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (map[unit] || 86_400_000);
}

/**
 * Atomic Clinic Onboarding:
 * 1. Create clinic
 * 2. Create owner account
 * 3. Associate owner with clinic
 * 4. Assign owner permissions / seed clinic roles
 * 5. Establish authenticated session
 *
 * Guarantees no partially created records on failure.
 */
async function onboardClinic({
  name,
  clinicName,
  slug,
  clinicSlug,
  email,
  ownerEmail,
  password,
  ownerPassword,
  nameOwner,
  ownerName,
  firstName,
  lastName,
  contact,
  phone,
  address,
  timezone = 'UTC',
  currency = 'USD',
  settings = {},
  userAgent,
  ip,
}) {
  const finalName = name || clinicName;
  const finalSlug = (slug || clinicSlug || '').toLowerCase().trim();
  const finalEmail = (email || ownerEmail || '').toLowerCase().trim();
  const finalPassword = password || ownerPassword;
  const finalOwnerName = ownerName || nameOwner || (firstName && lastName ? `${firstName} ${lastName}` : firstName || 'Owner');

  if (!finalName || !finalSlug) {
    throw AppError.badRequest('Clinic name and slug are required.', 'VALIDATION_ERROR');
  }
  if (!finalEmail || !finalPassword) {
    throw AppError.badRequest('Owner email and password are required.', 'VALIDATION_ERROR');
  }

  // Check unique slug
  const existingClinic = await Clinic.findOne({ slug: finalSlug });
  if (existingClinic) {
    throw AppError.conflict(`Clinic slug '${finalSlug}' is already taken.`, 'SLUG_TAKEN');
  }

  // Support transactions if available in environment (replica set), otherwise compensating rollback
  let session = null;
  let useTransaction = false;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    useTransaction = true;
  } catch {
    session = null;
    useTransaction = false;
  }

  let createdClinic = null;
  let createdUser = null;

  try {
    const sessionOpts = useTransaction ? { session } : {};

    // 1. Create clinic
    const clinicDoc = new Clinic({
      name: finalName,
      slug: finalSlug,
      contact: contact || (phone ? { phone, email: finalEmail } : { email: finalEmail }),
      phone: phone || (contact && contact.phone),
      email: finalEmail,
      address: address || {},
      timezone,
      currency,
      settings,
      status: 'active',
      isActive: true,
    });
    const savedClinic = await clinicDoc.save(sessionOpts);
    createdClinic = savedClinic;

    // 2. Create owner user
    const userDoc = new User({
      clinicId: savedClinic._id,
      name: finalOwnerName,
      firstName: firstName || finalOwnerName.split(' ')[0] || 'Owner',
      lastName: lastName || finalOwnerName.split(' ').slice(1).join(' ') || '',
      email: finalEmail,
      password: finalPassword,
      role: 'clinic_admin',
      permissions: ['*'],
      status: 'active',
      isActive: true,
    });
    const savedUser = await userDoc.save(sessionOpts);
    createdUser = savedUser;

    // 3. Associate owner with clinic
    savedClinic.ownerUserId = savedUser._id;
    await savedClinic.save(sessionOpts);

    // 4. Seed system roles for the new clinic
    const defaultRoles = [
      { name: 'clinic_admin', permissions: ['*'], isSystemRole: true },
      { name: 'dentist', permissions: ROLE_PERMISSIONS[UserRole.DENTIST] || [], isSystemRole: true },
      { name: 'receptionist', permissions: ROLE_PERMISSIONS[UserRole.RECEPTIONIST] || [], isSystemRole: true },
      { name: 'staff', permissions: ROLE_PERMISSIONS[UserRole.STAFF] || [], isSystemRole: true },
    ];

    for (const r of defaultRoles) {
      await Role.create([{ clinicId: savedClinic._id, ...r }], sessionOpts);
    }

    if (useTransaction && session) {
      await session.commitTransaction();
    }
  } catch (err) {
    if (useTransaction && session) {
      await session.abortTransaction();
    } else {
      // Compensating cleanup for standalone environments
      if (createdUser && createdUser._id) {
        await User.deleteOne({ _id: createdUser._id }).catch(() => {});
      }
      if (createdClinic && createdClinic._id) {
        await Role.deleteMany({ clinicId: createdClinic._id }).catch(() => {});
        await Clinic.deleteOne({ _id: createdClinic._id }).catch(() => {});
      }
    }
    throw err;
  } finally {
    if (session) {
      session.endSession();
    }
  }

  // 5. Establish authenticated session
  const accessTokenPayload = {
    sub: createdUser._id.toString(),
    clinicId: createdClinic._id.toString(),
    role: createdUser.role,
    permissions: createdUser.permissions,
  };
  const accessToken = signAccessToken(accessTokenPayload);
  const rawRefreshToken = generateSecureToken();
  const refreshToken = signRefreshToken({ sub: createdUser._id.toString(), jti: rawRefreshToken });
  const expiresAt = new Date(Date.now() + parseExpiryToMs(env.JWT_REFRESH_EXPIRES_IN));

  await RefreshToken.create({
    token: rawRefreshToken,
    userId: createdUser._id,
    clinicId: createdClinic._id,
    expiresAt,
    userAgent,
    ip,
  });

  return {
    clinic: createdClinic,
    user: createdUser,
    accessToken,
    refreshToken,
  };
}

/**
 * Get clinic details by ID.
 */
async function getClinicById(clinicId) {
  const clinic = await Clinic.findById(clinicId);
  if (!clinic) {
    throw AppError.notFound('Clinic not found.');
  }
  return clinic;
}

/**
 * Update clinic details.
 */
async function updateClinic(clinicId, updateData) {
  // Prevent changing slug or ownerUserId arbitrarily
  const { slug, ownerUserId, _id, ...safeUpdates } = updateData;

  const clinic = await Clinic.findByIdAndUpdate(
    clinicId,
    { $set: safeUpdates },
    { new: true, runValidators: true }
  );
  if (!clinic) {
    throw AppError.notFound('Clinic not found.');
  }
  return clinic;
}

module.exports = {
  onboardClinic,
  getClinicById,
  updateClinic,
};
