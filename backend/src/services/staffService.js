'use strict';

const User = require('../models/User');
const Clinic = require('../models/Clinic');
const Role = require('../models/Role');
const StaffInvitation = require('../models/StaffInvitation');
const RefreshToken = require('../models/RefreshToken');
const AppError = require('../errors/AppError');
const { generateSecureToken } = require('../utils/crypto');
const { signAccessToken, signRefreshToken } = require('../utils/jwt');
const env = require('../config/env');
const { ROLE_PERMISSIONS, UserRole } = require('@dentalflow/shared');

function parseExpiryToMs(expiry) {
  const unit = expiry.slice(-1);
  const value = parseInt(expiry.slice(0, -1), 10);
  const map = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (map[unit] || 86_400_000);
}

/**
 * Send an invitation to a staff member.
 */
async function inviteStaff(clinicId, inviterId, { email, name, role = 'receptionist', roleId = null, expiresInDays = 7 }) {
  const cleanEmail = email.toLowerCase().trim();

  // Verify staff user doesn't already exist in this clinic
  const existingUser = await User.findOne({ clinicId, email: cleanEmail });
  if (existingUser) {
    throw AppError.conflict('A user with this email already exists in this clinic.', 'USER_EXISTS');
  }

  // If roleId provided, verify it belongs to this clinic or is platform role
  let permissions = [];
  if (roleId) {
    const roleDoc = await Role.findOne({ _id: roleId, $or: [{ clinicId }, { clinicId: null }] });
    if (!roleDoc) {
      throw AppError.badRequest('Invalid role ID.');
    }
    permissions = roleDoc.permissions || [];
  } else if (ROLE_PERMISSIONS[role]) {
    permissions = ROLE_PERMISSIONS[role];
  }

  // Cancel any existing pending invitation for this email in this clinic
  await StaffInvitation.deleteMany({ clinicId, email: cleanEmail, status: 'pending' });

  const token = generateSecureToken(32);
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const invitation = await StaffInvitation.create({
    clinicId,
    email: cleanEmail,
    name,
    role,
    roleId,
    token,
    invitedBy: inviterId,
    expiresAt,
    status: 'pending',
  });

  return {
    invitation,
    token, // returned for sending in email or API tests
  };
}

/**
 * List pending invitations for the clinic.
 */
async function listInvitations(clinicId) {
  return StaffInvitation.find({ clinicId }).sort({ createdAt: -1 });
}

/**
 * Accept a staff invitation.
 */
async function acceptInvitation({ token, password, name, firstName, lastName, userAgent, ip }) {
  if (!token) {
    throw AppError.badRequest('Invitation token is required.');
  }

  const invitation = await StaffInvitation.findOne({ token });
  if (!invitation) {
    throw AppError.notFound('Invitation not found or invalid token.', 'INVALID_TOKEN');
  }

  if (invitation.status !== 'pending' || invitation.expiresAt < new Date()) {
    if (invitation.status === 'pending') {
      invitation.status = 'expired';
      await invitation.save();
    }
    throw AppError.badRequest('Invitation has expired or is no longer valid.', 'INVITATION_EXPIRED');
  }

  const finalName = name || (firstName && lastName ? `${firstName} ${lastName}` : firstName || invitation.name || 'Staff Member');

  // Verify role permissions
  let permissions = [];
  if (invitation.roleId) {
    const roleDoc = await Role.findById(invitation.roleId);
    if (roleDoc) {
      permissions = roleDoc.permissions || [];
    }
  }
  if (permissions.length === 0 && ROLE_PERMISSIONS[invitation.role]) {
    permissions = ROLE_PERMISSIONS[invitation.role];
  }

  // Create or activate the user in the clinic
  let user = await User.findOne({ clinicId: invitation.clinicId, email: invitation.email });
  if (user) {
    user.name = finalName;
    user.password = password;
    user.role = invitation.role;
    user.roleId = invitation.roleId;
    user.permissions = permissions;
    user.status = 'active';
    user.isActive = true;
    await user.save();
  } else {
    user = await User.create({
      clinicId: invitation.clinicId,
      email: invitation.email,
      password,
      name: finalName,
      firstName: firstName || finalName.split(' ')[0],
      lastName: lastName || finalName.split(' ').slice(1).join(' ') || '',
      role: invitation.role,
      roleId: invitation.roleId,
      permissions,
      status: 'active',
      isActive: true,
    });
  }

  // Mark invitation accepted
  invitation.status = 'accepted';
  invitation.acceptedAt = new Date();
  await invitation.save();

  // Establish session
  const clinic = await Clinic.findById(invitation.clinicId);
  const accessTokenPayload = {
    sub: user._id.toString(),
    clinicId: user.clinicId.toString(),
    role: user.role,
    permissions: user.permissions,
  };
  const accessToken = signAccessToken(accessTokenPayload);
  const rawRefreshToken = generateSecureToken();
  const refreshToken = signRefreshToken({ sub: user._id.toString(), jti: rawRefreshToken });
  const expiresAt = new Date(Date.now() + parseExpiryToMs(env.JWT_REFRESH_EXPIRES_IN));

  await RefreshToken.create({
    token: rawRefreshToken,
    userId: user._id,
    clinicId: user.clinicId,
    expiresAt,
    userAgent,
    ip,
  });

  return { user, clinic, accessToken, refreshToken };
}

/**
 * List staff members in the clinic.
 */
async function listStaff(clinicId, { role, status, search } = {}) {
  const query = { clinicId };

  if (role) {
    query.role = role;
  }
  if (status) {
    query.status = status;
  }
  if (search) {
    const searchRegex = new RegExp(search, 'i');
    query.$or = [{ name: searchRegex }, { email: searchRegex }, { firstName: searchRegex }, { lastName: searchRegex }];
  }

  const staff = await User.find(query)
    .populate('roleId', 'name permissions isSystemRole')
    .sort({ createdAt: -1 });

  return staff;
}

/**
 * Get staff member by ID within clinic scope.
 */
async function getStaffById(clinicId, staffId) {
  const user = await User.findOne({ _id: staffId, clinicId }).populate('roleId', 'name permissions isSystemRole');
  if (!user) {
    throw AppError.notFound('Staff member not found.');
  }
  return user;
}

/**
 * Update staff member details and role assignment.
 */
async function updateStaff(clinicId, staffId, { name, role, roleId, permissions }) {
  const user = await User.findOne({ _id: staffId, clinicId });
  if (!user) {
    throw AppError.notFound('Staff member not found.');
  }

  if (name) user.name = name;
  if (role) user.role = role;
  if (roleId !== undefined) {
    if (roleId) {
      const roleDoc = await Role.findOne({ _id: roleId, $or: [{ clinicId }, { clinicId: null }] });
      if (!roleDoc) {
        throw AppError.badRequest('Invalid role ID.');
      }
      user.roleId = roleId;
      if (roleDoc.permissions && roleDoc.permissions.length > 0) {
        user.permissions = roleDoc.permissions;
      }
    } else {
      user.roleId = null;
    }
  }
  if (permissions) user.permissions = permissions;

  await user.save();
  return user;
}

/**
 * Activate or deactivate staff member.
 */
async function setStaffStatus(clinicId, staffId, status, currentUserId) {
  if (!['active', 'inactive'].includes(status)) {
    throw AppError.badRequest("Status must be 'active' or 'inactive'.");
  }

  const user = await User.findOne({ _id: staffId, clinicId });
  if (!user) {
    throw AppError.notFound('Staff member not found.');
  }

  const clinic = await Clinic.findById(clinicId);
  if (clinic && clinic.ownerUserId && clinic.ownerUserId.toString() === staffId.toString() && status === 'inactive') {
    throw AppError.badRequest('Cannot deactivate the clinic owner.');
  }

  if (currentUserId && currentUserId.toString() === staffId.toString() && status === 'inactive') {
    throw AppError.badRequest('Cannot deactivate your own account.');
  }

  user.status = status;
  user.isActive = status === 'active';
  await user.save();

  // If deactivated, revoke all active refresh tokens for the user
  if (status === 'inactive') {
    await RefreshToken.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
  }

  return user;
}

module.exports = {
  inviteStaff,
  listInvitations,
  acceptInvitation,
  listStaff,
  getStaffById,
  updateStaff,
  setStaffStatus,
};
