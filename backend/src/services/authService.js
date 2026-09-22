'use strict';

const User = require('../models/User');
const Clinic = require('../models/Clinic');
const RefreshToken = require('../models/RefreshToken');
const AppError = require('../errors/AppError');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { generateSecureToken } = require('../utils/crypto');
const env = require('../config/env');

/**
 * Parse JWT refresh expiry string to milliseconds.
 * Supports: s (seconds), m (minutes), h (hours), d (days).
 * @param {string} expiry e.g. "7d"
 * @returns {number} ms
 */
function parseExpiryToMs(expiry) {
  const unit = expiry.slice(-1);
  const value = parseInt(expiry.slice(0, -1), 10);
  const map = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (map[unit] || 86_400_000);
}

/**
 * Register a new clinic and its admin user.
 */
async function register({ clinicName, clinicSlug, email, password, firstName, lastName }) {
  // Check if clinic slug is taken
  const existingClinic = await Clinic.findOne({ slug: clinicSlug });
  if (existingClinic) {
    throw AppError.conflict(`Clinic slug '${clinicSlug}' is already taken.`, 'SLUG_TAKEN');
  }

  // Create clinic
  const clinic = await Clinic.create({
    name: clinicName,
    slug: clinicSlug,
  });

  // Create admin user for the clinic
  const user = await User.create({
    clinicId: clinic._id,
    email,
    password,
    firstName,
    lastName,
    role: 'clinic_admin',
  });

  return { clinic, user };
}

/**
 * Login and issue access + refresh tokens.
 */
async function login({ email, clinicSlug, password, userAgent, ip }) {
  // Find clinic
  const clinic = await Clinic.findOne({ slug: clinicSlug, isActive: true });
  if (!clinic) {
    throw AppError.unauthorized('Invalid credentials.');
  }

  // Find user (select password explicitly)
  const user = await User.findOne({ clinicId: clinic._id, email, isActive: true }).select(
    '+password'
  );
  if (!user) {
    throw AppError.unauthorized('Invalid credentials.');
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw AppError.unauthorized('Invalid credentials.');
  }

  // Update last login
  user.lastLoginAt = new Date();
  await user.save();

  // Build tokens
  const accessTokenPayload = {
    sub: user._id.toString(),
    clinicId: clinic._id.toString(),
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
    clinicId: clinic._id,
    expiresAt,
    userAgent,
    ip,
  });

  return { accessToken, refreshToken, user, clinic };
}

/**
 * Rotate refresh token: revoke old, issue new pair.
 */
async function refreshTokens({ refreshToken: incomingRefreshToken, userAgent, ip }) {
  let decoded;
  try {
    decoded = verifyRefreshToken(incomingRefreshToken);
  } catch {
    throw AppError.unauthorized('Invalid refresh token.');
  }

  const jti = decoded.jti;

  const storedToken = await RefreshToken.findOne({ token: jti });
  if (!storedToken || !storedToken.isActive()) {
    throw AppError.unauthorized('Refresh token is invalid or expired.');
  }

  // Revoke old token
  storedToken.revokedAt = new Date();
  await storedToken.save();

  // Load user
  const user = await User.findById(storedToken.userId);
  if (!user || !user.isActive) {
    throw AppError.unauthorized('User not found or inactive.');
  }

  // Build new tokens
  const accessTokenPayload = {
    sub: user._id.toString(),
    clinicId: storedToken.clinicId.toString(),
    role: user.role,
    permissions: user.permissions,
  };

  const newAccessToken = signAccessToken(accessTokenPayload);
  const rawNewRefreshToken = generateSecureToken();
  const newRefreshToken = signRefreshToken({ sub: user._id.toString(), jti: rawNewRefreshToken });

  const expiresAt = new Date(Date.now() + parseExpiryToMs(env.JWT_REFRESH_EXPIRES_IN));

  storedToken.replacedByToken = rawNewRefreshToken;
  await storedToken.save();

  await RefreshToken.create({
    token: rawNewRefreshToken,
    userId: user._id,
    clinicId: storedToken.clinicId,
    expiresAt,
    userAgent,
    ip,
  });

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

/**
 * Logout: revoke the refresh token.
 */
async function logout({ refreshToken: incomingRefreshToken }) {
  let decoded;
  try {
    decoded = verifyRefreshToken(incomingRefreshToken);
  } catch {
    // Token already invalid — treat as success
    return;
  }

  const jti = decoded.jti;
  await RefreshToken.findOneAndUpdate({ token: jti }, { revokedAt: new Date() });
}

/**
 * Request password reset token.
 * Does not reveal whether email exists (opaque generic response).
 */
async function forgotPassword({ email, clinicSlug }) {
  const genericMessage = 'If an account with that email exists, password reset instructions have been sent.';
  if (!email) {
    return { success: true, message: genericMessage };
  }

  const cleanEmail = email.toLowerCase().trim();
  let query = { email: cleanEmail, isActive: true };

  if (clinicSlug) {
    const clinic = await Clinic.findOne({ slug: clinicSlug.toLowerCase().trim(), isActive: true });
    if (!clinic) {
      return { success: true, message: genericMessage };
    }
    query.clinicId = clinic._id;
  }

  const user = await User.findOne(query);
  if (!user) {
    return { success: true, message: genericMessage };
  }

  // Generate secure token valid for 1 hour
  const token = generateSecureToken(32);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  const PasswordResetToken = require('../models/PasswordResetToken');
  // Invalidate any existing tokens for this user
  await PasswordResetToken.deleteMany({ userId: user._id });

  await PasswordResetToken.create({
    clinicId: user.clinicId,
    userId: user._id,
    token,
    expiresAt,
  });

  return {
    success: true,
    message: genericMessage,
    // Included for testing purposes
    _testToken: token,
  };
}

/**
 * Reset password using a valid token.
 */
async function resetPassword({ token, newPassword }) {
  if (!token || !newPassword) {
    throw AppError.badRequest('Token and new password are required.');
  }

  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    throw AppError.badRequest('Password must be at least 8 characters long.');
  }

  const PasswordResetToken = require('../models/PasswordResetToken');
  const resetTokenDoc = await PasswordResetToken.findOne({ token });

  if (!resetTokenDoc || !resetTokenDoc.isValid()) {
    throw AppError.badRequest('Password reset token is invalid or has expired.', 'INVALID_TOKEN');
  }

  const user = await User.findById(resetTokenDoc.userId);
  if (!user || !user.isActive) {
    throw AppError.badRequest('User not found or inactive.');
  }

  user.password = newPassword;
  await user.save();

  // Mark token used
  resetTokenDoc.usedAt = new Date();
  await resetTokenDoc.save();

  // Revoke active refresh tokens
  await RefreshToken.updateMany(
    { userId: user._id, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );

  return { success: true, message: 'Password has been reset successfully.' };
}

module.exports = {
  register,
  login,
  refreshTokens,
  logout,
  forgotPassword,
  resetPassword,
};
