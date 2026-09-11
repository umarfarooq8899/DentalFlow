'use strict';

const { Router } = require('express');
const healthRoutes = require('./healthRoutes');
const authRoutes = require('./authRoutes');
const testRecordRoutes = require('./testRecordRoutes');

const router = Router();

router.use(healthRoutes);
router.use('/auth', authRoutes);
router.use('/test-records', testRecordRoutes);

module.exports = router;
