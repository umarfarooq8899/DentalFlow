'use strict';

const { Router } = require('express');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { createTestRecord, listTestRecords } = require('../../controllers/testRecordController');

const router = Router();

router.use(authenticate, tenantMiddleware);

router.get('/', listTestRecords);
router.post('/', createTestRecord);

module.exports = router;
