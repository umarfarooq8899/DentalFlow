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
const patientRoutes = require('./patientRoutes');
const dentalRecordRoutes = require('./dentalRecordRoutes');
const consentRoutes = require('./consentRoutes');
const documentRoutes = require('./documentRoutes');
const appointmentRoutes = require('./appointmentRoutes');

const router = Router();

router.use(healthRoutes);
router.use('/auth', authRoutes);
router.use('/clinics', clinicRoutes);
router.use('/roles', roleRoutes);
router.use('/staff', staffRoutes);
router.use('/dentists', dentistRoutes);
router.use('/services', serviceRoutes);
router.use('/patients', patientRoutes);
router.use('/dental-records', dentalRecordRoutes);
router.use('/consents', consentRoutes);
router.use('/documents', documentRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/test-records', testRecordRoutes);

module.exports = router;
