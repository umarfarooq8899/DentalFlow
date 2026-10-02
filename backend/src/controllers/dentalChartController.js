'use strict';

const { z } = require('zod');
const dentalChartService = require('../services/dentalChartService');
const {
  ALL_TOOTH_CONDITIONS,
  ALL_TOOTH_SURFACES,
  ALL_CHART_ENTRY_STATUSES,
} = require('@dentalflow/shared');

const recordToothSchema = z.object({
  toothNumber: z.number().int().min(1).max(32),
  condition: z.enum(ALL_TOOTH_CONDITIONS),
  surfaces: z.array(z.enum(ALL_TOOTH_SURFACES)).optional().default([]),
  notes: z.string().trim().max(1000).optional().default(''),
  status: z.enum(ALL_CHART_ENTRY_STATUSES).optional(),
  visitDate: z.string().datetime().optional().or(z.date().optional()),
  supersedesId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid supersedesId').optional().nullable(),
});

async function recordToothConditionHandler(req, res, next) {
  try {
    const parsed = recordToothSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input for tooth recording.',
          details: parsed.error.flatten(),
        },
      });
    }

    const entry = await dentalChartService.recordToothCondition(req.user.clinicId, {
      ...parsed.data,
      patientId: req.params.patientId,
      updatedBy: req.user.id,
    });

    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
}

async function getCurrentDentalChartHandler(req, res, next) {
  try {
    const chart = await dentalChartService.getCurrentDentalChart(
      req.user.clinicId,
      req.params.patientId
    );
    res.status(200).json({ success: true, data: chart });
  } catch (err) {
    next(err);
  }
}

async function getDentalChartStateAsOfHandler(req, res, next) {
  try {
    const asOfDate = req.query.date || req.query.asOfDate;
    if (!asOfDate) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_DATE',
          message: "Query parameter 'date' or 'asOfDate' is required.",
        },
      });
    }

    const chart = await dentalChartService.getDentalChartStateAsOf(
      req.user.clinicId,
      req.params.patientId,
      asOfDate
    );
    res.status(200).json({ success: true, data: chart });
  } catch (err) {
    next(err);
  }
}

async function getToothHistoryHandler(req, res, next) {
  try {
    const history = await dentalChartService.getToothHistory(
      req.user.clinicId,
      req.params.patientId,
      req.params.toothNumber
    );
    res.status(200).json({ success: true, data: history });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  recordToothConditionHandler,
  getCurrentDentalChartHandler,
  getDentalChartStateAsOfHandler,
  getToothHistoryHandler,
};
