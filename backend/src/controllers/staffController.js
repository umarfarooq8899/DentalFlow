'use strict';

const staffService = require('../services/staffService');

async function inviteStaffHandler(req, res, next) {
  try {
    const { invitation, token } = await staffService.inviteStaff(
      req.user.clinicId,
      req.user.id,
      req.body
    );

    res.status(201).json({
      success: true,
      data: {
        invitation,
        token, // returned for test verification & email dispatching
      },
    });
  } catch (err) {
    next(err);
  }
}

async function listInvitationsHandler(req, res, next) {
  try {
    const invitations = await staffService.listInvitations(req.user.clinicId);
    res.status(200).json({
      success: true,
      data: invitations,
    });
  } catch (err) {
    next(err);
  }
}

async function listStaffHandler(req, res, next) {
  try {
    const staff = await staffService.listStaff(req.user.clinicId, req.query);
    res.status(200).json({
      success: true,
      data: staff,
    });
  } catch (err) {
    next(err);
  }
}

async function getStaffHandler(req, res, next) {
  try {
    const staff = await staffService.getStaffById(req.user.clinicId, req.params.id);
    res.status(200).json({
      success: true,
      data: staff,
    });
  } catch (err) {
    next(err);
  }
}

async function updateStaffHandler(req, res, next) {
  try {
    const staff = await staffService.updateStaff(req.user.clinicId, req.params.id, req.body);
    res.status(200).json({
      success: true,
      data: staff,
    });
  } catch (err) {
    next(err);
  }
}

async function setStaffStatusHandler(req, res, next) {
  try {
    const staff = await staffService.setStaffStatus(
      req.user.clinicId,
      req.params.id,
      req.body.status,
      req.user.id
    );
    res.status(200).json({
      success: true,
      data: staff,
    });
  } catch (err) {
    next(err);
  }
}

async function acceptInvitationHandler(req, res, next) {
  try {
    const { user, clinic, accessToken, refreshToken } = await staffService.acceptInvitation({
      ...req.body,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        clinic: {
          id: clinic._id,
          name: clinic.name,
          slug: clinic.slug,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  inviteStaffHandler,
  listInvitationsHandler,
  listStaffHandler,
  getStaffHandler,
  updateStaffHandler,
  setStaffStatusHandler,
  acceptInvitationHandler,
};
