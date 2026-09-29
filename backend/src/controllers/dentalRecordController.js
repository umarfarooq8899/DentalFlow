'use strict';

const { z } = require('zod');
const dentalRecordService = require('../services/dentalRecordService');

const updateSchema = z.object({
  allergies: z.string().trim().optional(),
  medicalHistory: z.string().trim().optional(),
  medications: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

async function getDentalRecordHandler(req, res, next) {
  try {
    const record = await dentalRecordService.getOrCreateDentalRecord(
      req.user.clinicId,
      req.params.patientId
    );
    res.status(200).json({ success: true, data: record });
  } catch (err) {
    next(err);
  }
}

async function updateDentalRecordHandler(req, res, next) {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const record = await dentalRecordService.updateDentalRecord(
      req.user.clinicId,
      req.params.patientId,
      parsed.data,
      req.user.id
    );
    res.status(200).json({ success: true, data: record });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getDentalRecordHandler,
  updateDentalRecordHandler,
};
