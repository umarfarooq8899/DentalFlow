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

function meHandler(req, res) {
  res.status(200).json({
    success: true,
    data: { user: req.user },
  });
}

async function forgotPasswordHandler(req, res, next) {
  try {
    const { email, clinicSlug } = req.body;
    const result = await authService.forgotPassword({ email, clinicSlug });

    const responseData = {
      success: true,
      message: result.message,
    };

    // Expose reset token in test environment to allow verification without email mocking
    if (process.env.NODE_ENV === 'test' && result._testToken) {
      responseData._testToken = result._testToken;
    }

    res.status(200).json(responseData);
  } catch (err) {
    next(err);
  }
}

async function resetPasswordHandler(req, res, next) {
  try {
    const { token, newPassword } = req.body;
    const result = await authService.resetPassword({ token, newPassword });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  registerHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
};
