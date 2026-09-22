'use strict';

const dentistService = require('../services/dentistService');

async function createOrUpdateProfileHandler(req, res, next) {
  try {
    const profile = await dentistService.createOrUpdateProfile(req.user.clinicId, req.body);
    res.status(201).json({
      success: true,
      data: profile,
    });
  } catch (err) {
    next(err);
  }
}

async function getDentistProfileHandler(req, res, next) {
  try {
    const profile = await dentistService.getDentistProfile(req.user.clinicId, req.params.id);
    res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (err) {
    next(err);
  }
}

async function listDentistsHandler(req, res, next) {
  try {
    const dentists = await dentistService.listDentists(req.user.clinicId);
    res.status(200).json({
      success: true,
      data: dentists,
    });
  } catch (err) {
    next(err);
  }
}

async function updateDentistProfileHandler(req, res, next) {
  try {
    const profile = await dentistService.updateDentistProfile(
      req.user.clinicId,
      req.params.id,
      req.body
    );
    res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (err) {
    next(err);
  }
}

async function getDentistAvailabilityHandler(req, res, next) {
  try {
    const date = req.query.date;
    const availability = await dentistService.getDentistAvailability(
      req.user.clinicId,
      req.params.id,
      date
    );
    res.status(200).json({
      success: true,
      data: availability,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createOrUpdateProfileHandler,
  getDentistProfileHandler,
  listDentistsHandler,
  updateDentistProfileHandler,
  getDentistAvailabilityHandler,
};
