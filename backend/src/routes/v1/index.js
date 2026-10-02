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
const dentalChartRoutes = require('./dentalChartRoutes');
const treatmentPlanRoutes = require('./treatmentPlanRoutes');
const invoiceRoutes = require('./invoiceRoutes');
const paymentRoutes = require('./paymentRoutes');

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
router.use('/dental', dentalChartRoutes);
router.use('/treatment-plans', treatmentPlanRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/payments', paymentRoutes);
router.use('/consents', consentRoutes);
router.use('/documents', documentRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/test-records', testRecordRoutes);

module.exports = router;
