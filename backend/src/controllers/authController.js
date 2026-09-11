'use strict';

const authService = require('../services/authService');

async function registerHandler(req, res, next) {
  try {
    const { clinicName, clinicSlug, email, password, firstName, lastName } = req.body;
    const { clinic, user } = await authService.register({
      clinicName,
      clinicSlug,
      email,
      password,
      firstName,
      lastName,
    });

    res.status(201).json({
      success: true,
      data: {
        clinic: { id: clinic._id, name: clinic.name, slug: clinic.slug },
        user: { id: user._id, email: user.email, role: user.role },
      },
    });
  } catch (err) {
    next(err);
  }
}

async function loginHandler(req, res, next) {
  try {
    const { email, clinicSlug, password } = req.body;
    const { accessToken, refreshToken, user, clinic } = await authService.login({
      email,
      clinicSlug,
      password,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
        clinic: { id: clinic._id, name: clinic.name, slug: clinic.slug },
      },
    });
  } catch (err) {
    next(err);
  }
}

async function refreshHandler(req, res, next) {
  try {
    const { refreshToken } = req.body;
    const { accessToken, refreshToken: newRefreshToken } = await authService.refreshTokens({
      refreshToken,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      data: { accessToken, refreshToken: newRefreshToken },
    });
  } catch (err) {
    next(err);
  }
}

async function logoutHandler(req, res, next) {
  try {
    const { refreshToken } = req.body;
    await authService.logout({ refreshToken });

    res.status(200).json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
}

async function meHandler(req, res, next) {
  try {
    res.status(200).json({ success: true, data: { user: req.user } });
  } catch (err) {
    next(err);
  }
}

module.exports = { registerHandler, loginHandler, refreshHandler, logoutHandler, meHandler };
