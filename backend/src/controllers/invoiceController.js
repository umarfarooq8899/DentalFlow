'use strict';

const { z } = require('zod');
const invoiceService = require('../services/invoiceService');
const paymentService = require('../services/paymentService');
const { ALL_INVOICE_ITEM_TYPES, ALL_INVOICE_STATUSES } = require('@dentalflow/shared');

const invoiceItemSchema = z.object({
  type: z.enum(ALL_INVOICE_ITEM_TYPES).optional().default('other'),
  description: z.string().trim().min(1).max(500),
  quantity: z.number().int().positive().safe().optional().default(1),
  unitAmount: z.number().int().nonnegative().safe(),
}).strict();

const createInvoiceSchema = z.object({
  patientId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  treatmentPlanId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional().nullable(),
  items: z.array(invoiceItemSchema).min(1).max(100),
  discountAmount: z.number().int().nonnegative().safe().optional().default(0),
  taxAmount: z.number().int().nonnegative().safe().optional().default(0),
}).strict();

const generatedInvoiceSchema = z.object({
  discountAmount: z.number().int().nonnegative().safe().optional().default(0),
  taxAmount: z.number().int().nonnegative().safe().optional().default(0),
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

function validationError(res, parsed, message) {
  return res.status(400).json({
    success: false,
    error: { code: 'VALIDATION_ERROR', message, details: parsed.error.flatten() },
  });
}

async function createInvoiceHandler(req, res, next) {
  try {
    const key = idempotencyKeyFrom(req, res);
    if (!key) return;
    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed, 'Invalid invoice input.');
    const result = await invoiceService.createInvoice(req.user.clinicId, {
      ...parsed.data,
      idempotencyKey: key,
      createdBy: req.user.id,
    });
    res.status(result.isDuplicate ? 200 : 201).json({ success: true, data: result.invoice, isDuplicate: result.isDuplicate });
  } catch (error) {
    next(error);
  }
}

async function createInvoiceFromTreatmentPlanHandler(req, res, next) {
  try {
    const key = idempotencyKeyFrom(req, res);
    if (!key) return;
    const parsed = generatedInvoiceSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed, 'Invalid invoice generation input.');
    const result = await invoiceService.createInvoiceFromTreatmentPlan(req.user.clinicId, req.params.planId, {
      ...parsed.data,
      idempotencyKey: key,
      createdBy: req.user.id,
    });
    res.status(result.isDuplicate ? 200 : 201).json({ success: true, data: result.invoice, isDuplicate: result.isDuplicate });
  } catch (error) {
    next(error);
  }
}

async function getInvoiceHandler(req, res, next) {
  try {
    const invoice = await invoiceService.getInvoice(req.user.clinicId, req.params.id);
    res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
}

async function listInvoicesHandler(req, res, next) {
  try {
    const result = await invoiceService.listInvoices(req.user.clinicId, req.query);
    res.status(200).json({ success: true, data: result.invoices, pagination: result.pagination });
  } catch (error) {
    next(error);
  }
}

async function transitionInvoiceStatusHandler(req, res, next) {
  try {
    const schema = z.object({ status: z.enum(ALL_INVOICE_STATUSES) }).strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed, 'Invalid invoice status input.');
    const invoice = await invoiceService.transitionInvoiceStatus(req.user.clinicId, req.params.id, parsed.data.status);
    res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
}

async function getInvoicePaymentsHandler(req, res, next) {
  try {
    await invoiceService.getInvoice(req.user.clinicId, req.params.id);
    const result = await paymentService.listPayments(req.user.clinicId, {
      invoiceId: req.params.id,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.status(200).json({ success: true, data: result.payments, pagination: result.pagination });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createInvoiceHandler,
  createInvoiceFromTreatmentPlanHandler,
  getInvoiceHandler,
  listInvoicesHandler,
  transitionInvoiceStatusHandler,
  getInvoicePaymentsHandler,
};