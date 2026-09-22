'use strict';

const { Router } = require('express');
const {
  onboardClinicHandler,
  getCurrentClinicHandler,
  updateCurrentClinicHandler,
} = require('../../controllers/clinicController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requireRole } = require('../../middlewares/requirePermission');

const router = Router();

// Public: Onboard a new clinic (creates clinic + owner account)
router.post('/onboard', onboardClinicHandler);

// Authenticated: Get / update current clinic
router.get('/me', authenticate, tenantMiddleware, getCurrentClinicHandler);
router.patch('/me', authenticate, tenantMiddleware, requireRole('clinic_admin'), updateCurrentClinicHandler);

module.exports = router;
