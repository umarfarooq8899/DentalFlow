'use strict';

const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const TreatmentPlan = require('../models/TreatmentPlan');
const AppError = require('../errors/AppError');
const { addCents } = require('../utils/money');
const { hashPayload } = require('../utils/idempotency');
const { InvoiceStatus } = require('@dentalflow/shared');
const { validateIdempotencyKey } = require('./invoiceService');

function paymentView(payment) {
  const value = payment.toObject ? payment.toObject() : { ...payment };
  value.id = String(value._id || value.id);
  delete value._id;
  delete value.__v;
  delete value.idempotencyKey;
  delete value.requestHash;
  return value;
}

function normalizeAllocations(allocations) {
  if (!Array.isArray(allocations) || allocations.length === 0) {
    throw AppError.badRequest('At least one invoice allocation is required.');
  }
  const byInvoice = new Map();
  for (const allocation of allocations) {
    if (!mongoose.isValidObjectId(allocation.invoiceId)) throw AppError.badRequest('Invalid allocation invoiceId.');
    if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) {
      throw AppError.badRequest('Allocation amounts must be positive integer cents.');
    }
    const invoiceId = String(allocation.invoiceId);
    byInvoice.set(invoiceId, addCents(byInvoice.get(invoiceId) || 0, allocation.amount));
  }
  return [...byInvoice.entries()]
    .map(([invoiceId, amount]) => ({ invoiceId, amount }))
    .sort((left, right) => left.invoiceId.localeCompare(right.invoiceId));
}

async function findIdempotentPayment(clinicId, key, requestHash) {
  const existing = await Payment.findOne({ clinicId, idempotencyKey: key }).select('+requestHash').lean();
  if (!existing) return null;
  if (existing.requestHash !== requestHash) {
    throw AppError.conflict('Idempotency-Key was already used for a different payment operation.', 'IDEMPOTENCY_KEY_REUSED');
  }
  return { payment: paymentView(existing), isDuplicate: true };
}

async function recordPayment(clinicId, {
  amount,
  allocations,
  method = 'cash',
  reference = '',
  notes = '',
  idempotencyKey,
  recordedBy,
}) {
  const key = validateIdempotencyKey(idempotencyKey);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw AppError.badRequest('Payment amount must be positive integer cents.');
  const normalizedAllocations = normalizeAllocations(allocations);
  const allocationTotal = addCents(...normalizedAllocations.map((entry) => entry.amount));
  if (allocationTotal !== amount) throw AppError.badRequest('Payment amount must equal the sum of its invoice allocations.');

  const requestHash = hashPayload({
    operation: 'invoice.payment',
    amount,
    allocations: normalizedAllocations,
    method,
    reference: reference || '',
    notes: notes || '',
  });
  const replay = await findIdempotentPayment(clinicId, key, requestHash);
  if (replay) return replay;

  let created;
  let isDuplicate = false;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const existing = await Payment.findOne({ clinicId, idempotencyKey: key })
        .select('+requestHash')
        .session(session)
        .lean();
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw AppError.conflict('Idempotency-Key was already used for a different payment operation.', 'IDEMPOTENCY_KEY_REUSED');
        }
        created = existing;
        isDuplicate = true;
        return;
      }

      const invoiceIds = normalizedAllocations.map((allocation) => allocation.invoiceId);
      const invoices = await Invoice.find({ _id: { $in: invoiceIds }, clinicId }).session(session);
      if (invoices.length !== invoiceIds.length) throw AppError.notFound('One or more invoices were not found.');

      const byId = new Map(invoices.map((invoice) => [String(invoice._id), invoice]));
      const patientIds = new Set(invoices.map((invoice) => String(invoice.patientId)));
      if (patientIds.size !== 1) throw AppError.badRequest('A payment cannot be allocated across different patients.');

      const planAllocations = new Map();
      for (const allocation of normalizedAllocations) {
        const invoice = byId.get(allocation.invoiceId);
        if (![InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE].includes(invoice.status)) {
          throw AppError.badRequest(`Invoice '${allocation.invoiceId}' is not payable.`, 'INVOICE_NOT_PAYABLE');
        }
        const outstanding = Math.max(0, invoice.total - invoice.paidTotal);
        if (allocation.amount > outstanding) {
          throw AppError.badRequest('Payment allocation exceeds the invoice outstanding balance.', 'PAYMENT_EXCEEDS_BALANCE');
        }
        const resultingPaidTotal = addCents(invoice.paidTotal, allocation.amount);
        const nextStatus = resultingPaidTotal === invoice.total
          ? InvoiceStatus.PAID
          : InvoiceStatus.PARTIALLY_PAID;
        const updated = await Invoice.findOneAndUpdate(
          {
            _id: invoice._id,
            clinicId,
            status: { $in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] },
            $expr: { $gte: [{ $subtract: ['$total', '$paidTotal'] }, allocation.amount] },
          },
          { $inc: { paidTotal: allocation.amount }, $set: { status: nextStatus } },
          { new: true, session }
        );
        if (!updated) throw AppError.conflict('Invoice balance changed while recording payment. Retry the request.', 'PAYMENT_CONFLICT');

        if (invoice.treatmentPlanId) {
          const planKey = String(invoice.treatmentPlanId);
          planAllocations.set(planKey, addCents(planAllocations.get(planKey) || 0, allocation.amount));
        }
      }

      for (const [planId, planAmount] of planAllocations) {
        const planUpdate = await TreatmentPlan.updateOne(
          { _id: planId, clinicId },
          { $inc: { paidTotal: planAmount } },
          { session }
        );
        if (planUpdate.matchedCount !== 1) throw AppError.conflict('The treatment plan linked to an invoice no longer exists.');
      }

      const firstInvoice = byId.get(normalizedAllocations[0].invoiceId);
      [created] = await Payment.create([{
        clinicId,
        patientId: firstInvoice.patientId,
        invoiceId: normalizedAllocations.length === 1 ? normalizedAllocations[0].invoiceId : null,
        treatmentPlanId: planAllocations.size === 1 ? [...planAllocations.keys()][0] : null,
        allocations: normalizedAllocations,
        amount,
        method,
        reference,
        notes,
        idempotencyKey: key,
        requestHash,
        recordedBy,
        paidAt: new Date(),
      }], { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const duplicate = await findIdempotentPayment(clinicId, key, requestHash);
      if (duplicate) return duplicate;
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return { payment: paymentView(created), isDuplicate };
}

async function listPayments(clinicId, { patientId, invoiceId, page = 1, limit = 20 } = {}) {
  const query = { clinicId };
  if (patientId) {
    if (!mongoose.isValidObjectId(patientId)) throw AppError.badRequest('Invalid patientId.');
    query.patientId = patientId;
  }
  if (invoiceId) {
    if (!mongoose.isValidObjectId(invoiceId)) throw AppError.badRequest('Invalid invoiceId.');
    query.$or = [{ invoiceId }, { 'allocations.invoiceId': invoiceId }];
  }
  const pageNumber = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const [payments, total] = await Promise.all([
    Payment.find(query).populate('recordedBy', 'name email role')
      .sort({ paidAt: -1 }).skip((pageNumber - 1) * pageSize).limit(pageSize).lean(),
    Payment.countDocuments(query),
  ]);
  return {
    payments: payments.map(paymentView),
    pagination: { total, page: pageNumber, limit: pageSize, pages: Math.ceil(total / pageSize) },
  };
}

module.exports = { recordPayment, listPayments, paymentView };