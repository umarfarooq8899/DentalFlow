'use strict';

const { Router } = require('express');
const healthRoutes = require('./healthRoutes');
const authRoutes = require('./authRoutes');
const testRecordRoutes = require('./testRecordRoutes');
const clinicRoutes = require('./clinicRoutes');
const roleRoutes = require('./roleRoutes');
const staffRoutes = require('./staffRoutes');
const dentistRoutes = require('./dentistRoutes');
const serviceRoutes = require('./serviceRoutes');

const router = Router();

router.use(healthRoutes);
router.use('/auth', authRoutes);
router.use('/clinics', clinicRoutes);
router.use('/roles', roleRoutes);
router.use('/staff', staffRoutes);
router.use('/dentists', dentistRoutes);
router.use('/services', serviceRoutes);
router.use('/test-records', testRecordRoutes);

module.exports = router;
