'use strict';

const { z } = require('zod');
const treatmentPlanService = require('../services/treatmentPlanService');
const {
  ALL_TREATMENT_PLAN_STATUSES,
  ALL_TREATMENT_PROCEDURE_STATUSES,
  ALL_PAYMENT_METHODS,
} = require('@dentalflow/shared');

const procedureInputSchema = z.object({
  toothNumber: z.number().int().min(1).max(32).optional().nullable(),
  serviceId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional().nullable(),
  description: z.string().trim().max(500).optional().default(''),
  price: z.number().int().min(0, 'Price must be in minor units (cents) and non-negative.'),
  status: z.enum(ALL_TREATMENT_PROCEDURE_STATUSES).optional(),
  notes: z.string().trim().max(1000).optional().default(''),
});

const createPlanSchema = z.object({
  patientId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid patientId'),
  dentistId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid dentistId'),
  title: z.string().trim().min(1).max(200),
  status: z.enum(ALL_TREATMENT_PLAN_STATUSES).optional(),
  notes: z.string().trim().max(2000).optional().default(''),
  procedures: z.array(procedureInputSchema).optional().default([]),
});

const updatePlanSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  status: z.enum(ALL_TREATMENT_PLAN_STATUSES).optional(),
});

const recordPaymentSchema = z.object({
  amount: z.number().int().min(1, 'Amount must be in positive integer minor units (cents).'),
  method: z.enum(ALL_PAYMENT_METHODS).optional(),
  reference: z.string().trim().max(200).optional().default(''),
  notes: z.string().trim().max(1000).optional().default(''),
});

async function createTreatmentPlanHandler(req, res, next) {
  try {
    const parsed = createPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input for treatment plan.',
          details: parsed.error.flatten(),
        },
      });
    }

    const plan = await treatmentPlanService.createTreatmentPlan(req.user.clinicId, parsed.data);
    res.status(201).json({ success: true, data: plan });
  } catch (err) {
    next(err);
  }
}

async function getTreatmentPlanHandler(req, res, next) {
  try {
    const plan = await treatmentPlanService.getTreatmentPlan(req.user.clinicId, req.params.id);
    res.status(200).json({ success: true, data: plan });
  } catch (err) {
    next(err);
  }
}

async function listTreatmentPlansHandler(req, res, next) {
  try {
    const { patientId, dentistId, status, page, limit } = req.query;
    const result = await treatmentPlanService.listTreatmentPlans(req.user.clinicId, {
      patientId,
      dentistId,
      status,
      page,
      limit,
    });
    res.status(200).json({ success: true, data: result.plans, pagination: result.pagination });
  } catch (err) {
    next(err);
  }
}

async function updateTreatmentPlanHandler(req, res, next) {
  try {
    const parsed = updatePlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input.',
          details: parsed.error.flatten(),
        },
      });
    }

    const plan = await treatmentPlanService.updateTreatmentPlan(
      req.user.clinicId,
      req.params.id,
      parsed.data
    );
    res.status(200).json({ success: true, data: plan });
  } catch (err) {
    next(err);
  }
}

async function addProcedureHandler(req, res, next) {
  try {
    const parsed = procedureInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid procedure input.',
          details: parsed.error.flatten(),
        },
      });
    }

    const proc = await treatmentPlanService.addProcedure(
      req.user.clinicId,
      req.params.id,
      parsed.data
    );
    res.status(201).json({ success: true, data: proc });
  } catch (err) {
    next(err);
  }
}

async function updateProcedureHandler(req, res, next) {
  try {
    const proc = await treatmentPlanService.updateProcedure(
      req.user.clinicId,
      req.params.id,
      req.params.procedureId,
      req.body
    );
    res.status(200).json({ success: true, data: proc });
  } catch (err) {
    next(err);
  }
}

async function completeProcedureHandler(req, res, next) {
  try {
    const proc = await treatmentPlanService.completeProcedure(
      req.user.clinicId,
      req.params.id,
      req.params.procedureId,
      { completedBy: req.user.id }
    );
    res.status(200).json({ success: true, data: proc });
  } catch (err) {
    next(err);
  }
}

async function recordPaymentHandler(req, res, next) {
  try {
    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;
    if (!idempotencyKey) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_IDEMPOTENCY_KEY',
          message: 'Idempotency-Key header is required for payment processing.',
        },
      });
    }

    const parsed = recordPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid payment input.',
          details: parsed.error.flatten(),
        },
      });
    }

    const result = await treatmentPlanService.recordPayment(req.user.clinicId, req.params.id, {
      ...parsed.data,
      idempotencyKey,
      recordedBy: req.user.id,
    });

    const status = result.isDuplicate ? 200 : 201;
    res.status(status).json({
      success: true,
      data: result.payment,
      remainingBalance: result.remainingBalance,
      isDuplicate: result.isDuplicate,
    });
  } catch (err) {
    next(err);
  }
}

async function getPaymentsHandler(req, res, next) {
  try {
    const payments = await treatmentPlanService.getPaymentsForPlan(
      req.user.clinicId,
      req.params.id
    );
    res.status(200).json({ success: true, data: payments });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createTreatmentPlanHandler,
  getTreatmentPlanHandler,
  listTreatmentPlansHandler,
  updateTreatmentPlanHandler,
  addProcedureHandler,
  updateProcedureHandler,
  completeProcedureHandler,
  recordPaymentHandler,
  getPaymentsHandler,
};
