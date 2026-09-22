'use strict';

const clinicService = require('../services/clinicService');

async function onboardClinicHandler(req, res, next) {
  try {
    const { clinic, user, accessToken, refreshToken } = await clinicService.onboardClinic({
      ...req.body,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });

    res.status(201).json({
      success: true,
      data: {
        clinic: {
          id: clinic._id,
          name: clinic.name,
          slug: clinic.slug,
          status: clinic.status,
          timezone: clinic.timezone,
          currency: clinic.currency,
          ownerUserId: clinic.ownerUserId,
        },
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getCurrentClinicHandler(req, res, next) {
  try {
    const clinic = await clinicService.getClinicById(req.user.clinicId);
    res.status(200).json({
      success: true,
      data: { clinic },
    });
  } catch (err) {
    next(err);
  }
}

async function updateCurrentClinicHandler(req, res, next) {
  try {
    const clinic = await clinicService.updateClinic(req.user.clinicId, req.body);
    res.status(200).json({
      success: true,
      data: { clinic },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  onboardClinicHandler,
  getCurrentClinicHandler,
  updateCurrentClinicHandler,
};
