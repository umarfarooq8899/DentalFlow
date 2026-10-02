'use strict';

const { z } = require('zod');
const paymentService = require('../services/paymentService');
const { ALL_PAYMENT_METHODS } = require('@dentalflow/shared');

const createPaymentSchema = z.object({
  amount: z.number().int().positive().safe(),
  allocations: z.array(z.object({
    invoiceId: z.string().regex(/^[a-fA-F0-9]{24}$/),
    amount: z.number().int().positive().safe(),
  }).strict()).min(1).max(100),
  method: z.enum(ALL_PAYMENT_METHODS).optional(),
  reference: z.string().trim().max(200).optional().default(''),
  notes: z.string().trim().max(1000).optional().default(''),
}).strict();

function idempotencyKeyFrom(req, res) {
  const value = req.get('Idempotency-Key');
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 255) {
    res.status(400).json({
      success: false,
      error: { code: 'MISSING_IDEMPOTENCY_KEY', message: 'A valid Idempotency-Key header is required.' },
    });
    return null;
  }
  return value.trim();
}

async function createPaymentHandler(req, res, next) {
  try {
    const idempotencyKey = idempotencyKeyFrom(req, res);
    if (!idempotencyKey) return;
    const parsed = createPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid payment input.', details: parsed.error.flatten() },
      });
    }
    const result = await paymentService.recordPayment(req.user.clinicId, {
      ...parsed.data,
      method: parsed.data.method || 'cash',
      idempotencyKey,
      recordedBy: req.user.id,
    });
    res.status(result.isDuplicate ? 200 : 201).json({ success: true, data: result.payment, isDuplicate: result.isDuplicate });
  } catch (error) {
    next(error);
  }
}

async function listPaymentsHandler(req, res, next) {
  try {
    const result = await paymentService.listPayments(req.user.clinicId, req.query);
    res.status(200).json({ success: true, data: result.payments, pagination: result.pagination });
  } catch (error) {
    next(error);
  }
}

module.exports = { createPaymentHandler, listPaymentsHandler };