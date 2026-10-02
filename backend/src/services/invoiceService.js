'use strict';

const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Patient = require('../models/Patient');
const TreatmentPlan = require('../models/TreatmentPlan');
const TreatmentProcedure = require('../models/TreatmentProcedure');
const AppError = require('../errors/AppError');
const { addCents, assertValidCents } = require('../utils/money');
const { hashPayload } = require('../utils/idempotency');
const {
  ALL_INVOICE_ITEM_TYPES,
  ALL_INVOICE_STATUSES,
  INVOICE_STATUS_TRANSITIONS,
  InvoiceStatus,
  TreatmentProcedureStatus,
} = require('@dentalflow/shared');

function invoiceView(invoice) {
  const value = invoice.toObject ? invoice.toObject() : { ...invoice };
  value.id = String(value._id || value.id);
  delete value._id;
  delete value.__v;
  delete value.idempotencyKey;
  delete value.requestHash;
  value.outstandingBalance = value.status === InvoiceStatus.VOIDED
    ? 0
    : Math.max(0, value.total - value.paidTotal);
  return value;
}

function normalizeInvoiceAmounts({ items, discountAmount = 0, taxAmount = 0 }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw AppError.badRequest('At least one invoice item is required.');
  }

  const normalizedItems = items.map((item) => {
    const quantity = item.quantity ?? 1;
    const unitAmount = item.unitAmount;
    if (!ALL_INVOICE_ITEM_TYPES.includes(item.type || 'other')) {
      throw AppError.badRequest('Invalid invoice item type.');
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(unitAmount) || unitAmount < 0) {
      throw AppError.badRequest('Invoice quantities and unit amounts must be non-negative safe integers in cents.');
    }
    const lineTotal = quantity * unitAmount;
    assertValidCents(lineTotal);
    return {
      type: item.type || 'other',
      description: String(item.description || '').trim(),
      quantity,
      unitAmount,
      lineTotal,
    };
  });

  if (normalizedItems.some((item) => !item.description)) {
    throw AppError.badRequest('Invoice item descriptions are required.');
  }
  if (!Number.isSafeInteger(discountAmount) || discountAmount < 0
    || !Number.isSafeInteger(taxAmount) || taxAmount < 0) {
    throw AppError.badRequest('Discount and tax amounts must be non-negative safe integers in cents.');
  }

  const subtotal = addCents(...normalizedItems.map((item) => item.lineTotal));
  if (discountAmount > subtotal) throw AppError.badRequest('Discount cannot exceed the invoice subtotal.');
  const total = addCents(subtotal - discountAmount, taxAmount);
  return { items: normalizedItems, subtotal, discountAmount, taxAmount, total };
}

async function findIdempotentInvoice(clinicId, idempotencyKey, requestHash) {
  const existing = await Invoice.findOne({ clinicId, idempotencyKey }).select('+requestHash').lean();
  if (!existing) return null;
  if (existing.requestHash !== requestHash) {
    throw AppError.conflict('Idempotency-Key was already used for a different invoice operation.', 'IDEMPOTENCY_KEY_REUSED');
  }
  return { invoice: invoiceView(existing), isDuplicate: true };
}

function validateIdempotencyKey(idempotencyKey) {
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.trim().length > 255) {
    throw AppError.badRequest('A valid Idempotency-Key header is required.', 'MISSING_IDEMPOTENCY_KEY');
  }
  return idempotencyKey.trim();
}

async function createInvoice(clinicId, {
  patientId,
  treatmentPlanId = null,
  items,
  discountAmount = 0,
  taxAmount = 0,
  idempotencyKey,
  createdBy,
  requestHashOverride,
}) {
  if (!mongoose.isValidObjectId(patientId)) throw AppError.badRequest('Invalid patientId.');
  if (treatmentPlanId && !mongoose.isValidObjectId(treatmentPlanId)) throw AppError.badRequest('Invalid treatmentPlanId.');
  const key = validateIdempotencyKey(idempotencyKey);
  const amounts = normalizeInvoiceAmounts({ items, discountAmount, taxAmount });
  const requestHash = requestHashOverride
    || hashPayload({ operation: 'invoice.create', patientId, treatmentPlanId, ...amounts });

  const replay = await findIdempotentInvoice(clinicId, key, requestHash);
  if (replay) return replay;

  const patient = await Patient.findOne({ _id: patientId, clinicId }).lean();
  if (!patient) throw AppError.notFound('Patient not found.');
  if (treatmentPlanId) {
    const plan = await TreatmentPlan.findOne({ _id: treatmentPlanId, clinicId }).lean();
    if (!plan || String(plan.patientId) !== String(patientId)) {
      throw AppError.notFound('Treatment plan not found for this patient.');
    }
  }

  let created;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      [created] = await Invoice.create([{
        clinicId,
        patientId,
        treatmentPlanId,
        ...amounts,
        idempotencyKey: key,
        requestHash,
        createdBy,
      }], { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const duplicate = await findIdempotentInvoice(clinicId, key, requestHash);
      if (duplicate) return duplicate;
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return { invoice: invoiceView(created), isDuplicate: false };
}

async function createInvoiceFromTreatmentPlan(clinicId, planId, {
  discountAmount = 0,
  taxAmount = 0,
  idempotencyKey,
  createdBy,
}) {
  if (!mongoose.isValidObjectId(planId)) throw AppError.badRequest('Invalid treatmentPlanId.');
  const key = validateIdempotencyKey(idempotencyKey);
  const requestHash = hashPayload({ operation: 'invoice.fromTreatmentPlan', planId: String(planId), discountAmount, taxAmount });
  const replay = await findIdempotentInvoice(clinicId, key, requestHash);
  if (replay) return replay;

  const plan = await TreatmentPlan.findOne({ _id: planId, clinicId }).lean();
  if (!plan) throw AppError.notFound('Treatment plan not found.');
  const procedures = await TreatmentProcedure.find({
    clinicId,
    treatmentPlanId: planId,
    status: { $ne: TreatmentProcedureStatus.CANCELLED },
  }).sort({ createdAt: 1 }).lean();

  const items = procedures.map((procedure) => ({
    type: 'procedure',
    description: procedure.description || 'Treatment procedure',
    quantity: 1,
    unitAmount: procedure.price,
  }));
  if (items.length === 0) throw AppError.badRequest('Cannot invoice a treatment plan with no active procedures.');

  return createInvoice(clinicId, {
    patientId: String(plan.patientId),
    treatmentPlanId: String(planId),
    items,
    discountAmount,
    taxAmount,
    idempotencyKey: key,
    createdBy,
    requestHashOverride: requestHash,
  });
}

async function getInvoice(clinicId, invoiceId) {
  if (!mongoose.isValidObjectId(invoiceId)) throw AppError.notFound('Invoice not found.');
  const invoice = await Invoice.findOne({ _id: invoiceId, clinicId }).lean();
  if (!invoice) throw AppError.notFound('Invoice not found.');
  return invoiceView(invoice);
}

async function listInvoices(clinicId, { patientId, status, page = 1, limit = 20 } = {}) {
  const query = { clinicId };
  if (patientId) {
    if (!mongoose.isValidObjectId(patientId)) throw AppError.badRequest('Invalid patientId.');
    query.patientId = patientId;
  }
  if (status) {
    if (!ALL_INVOICE_STATUSES.includes(status)) throw AppError.badRequest('Invalid invoice status.');
    query.status = status;
  }
  const pageNumber = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const [invoices, total] = await Promise.all([
    Invoice.find(query).sort({ createdAt: -1 }).skip((pageNumber - 1) * pageSize).limit(pageSize).lean(),
    Invoice.countDocuments(query),
  ]);
  return {
    invoices: invoices.map(invoiceView),
    pagination: { total, page: pageNumber, limit: pageSize, pages: Math.ceil(total / pageSize) },
  };
}

async function transitionInvoiceStatus(clinicId, invoiceId, nextStatus) {
  if (!mongoose.isValidObjectId(invoiceId)) throw AppError.notFound('Invoice not found.');
  if (!ALL_INVOICE_STATUSES.includes(nextStatus)) throw AppError.badRequest('Invalid invoice status.');
  if (![InvoiceStatus.ISSUED, InvoiceStatus.VOIDED].includes(nextStatus)) {
    throw AppError.badRequest('Invoice status is managed by billing rules and cannot be set directly.');
  }

  const invoice = await Invoice.findOne({ _id: invoiceId, clinicId });
  if (!invoice) throw AppError.notFound('Invoice not found.');
  const allowed = INVOICE_STATUS_TRANSITIONS[invoice.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw AppError.badRequest(`Invalid invoice status transition from '${invoice.status}' to '${nextStatus}'.`, 'INVALID_STATUS_TRANSITION');
  }
  const update = { status: nextStatus };
  if (nextStatus === InvoiceStatus.ISSUED) update.issuedAt = new Date();
  if (nextStatus === InvoiceStatus.VOIDED) update.voidedAt = new Date();
  const changed = await Invoice.findOneAndUpdate(
    { _id: invoiceId, clinicId, status: invoice.status },
    { $set: update },
    { new: true }
  );
  if (!changed) throw AppError.conflict('Invoice status changed concurrently. Reload it and retry.', 'INVOICE_STATUS_CONFLICT');
  return invoiceView(changed);
}

module.exports = {
  createInvoice,
  createInvoiceFromTreatmentPlan,
  getInvoice,
  listInvoices,
  transitionInvoiceStatus,
  invoiceView,
  validateIdempotencyKey,
};