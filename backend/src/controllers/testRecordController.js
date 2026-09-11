'use strict';

const TestRecord = require('../models/TestRecord');
const { getCurrentClinicId } = require('../multitenancy/tenantContext');

async function createTestRecord(req, res, next) {
  try {
    const { title, description } = req.body;
    const record = await TestRecord.create({
      title,
      description,
      createdBy: req.user.id,
      clinicId: getCurrentClinicId(),
    });
    res.status(201).json({ success: true, data: record });
  } catch (err) {
    next(err);
  }
}

async function listTestRecords(req, res, next) {
  try {
    const records = await TestRecord.find({});
    res.status(200).json({ success: true, data: records });
  } catch (err) {
    next(err);
  }
}

module.exports = { createTestRecord, listTestRecords };
