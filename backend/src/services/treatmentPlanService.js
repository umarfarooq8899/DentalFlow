'use strict';

const mongoose = require('mongoose');
const TreatmentPlan = require('../models/TreatmentPlan');
const TreatmentProcedure = require('../models/TreatmentProcedure');
const Payment = require('../models/Payment');
const Patient = require('../models/Patient');
const DentistProfile = require('../models/DentistProfile');
const AppError = require('../errors/AppError');
const { hashPayload } = require('../utils/idempotency');
const {
  toCents,
  addCents,
  subtractCents,
} = require('../utils/money');
const {
  isValidToothNumber,
  ALL_TREATMENT_PLAN_STATUSES,
  ALL_TREATMENT_PROCEDURE_STATUSES,
  TreatmentPlanStatus,
  TreatmentProcedureStatus,
} = require('@dentalflow/shared');

// Valid status transitions for TreatmentPlan
const VALID_PLAN_TRANSITIONS = {
  [TreatmentPlanStatus.DRAFT]: [TreatmentPlanStatus.PRESENTED, TreatmentPlanStatus.REJECTED, TreatmentPlanStatus.ACCEPTED],
  [TreatmentPlanStatus.PRESENTED]: [TreatmentPlanStatus.ACCEPTED, TreatmentPlanStatus.REJECTED, TreatmentPlanStatus.DRAFT],
  [TreatmentPlanStatus.ACCEPTED]: [TreatmentPlanStatus.IN_PROGRESS, TreatmentPlanStatus.REJECTED, TreatmentPlanStatus.COMPLETED],
  [TreatmentPlanStatus.IN_PROGRESS]: [TreatmentPlanStatus.COMPLETED, TreatmentPlanStatus.REJECTED],
  [TreatmentPlanStatus.REJECTED]: [TreatmentPlanStatus.DRAFT],
  [TreatmentPlanStatus.COMPLETED]: [], // Terminal state
};

/**
 * Recalculate and update the estimatedTotal for a treatment plan.
 * Only non-cancelled procedures contribute to the total.
 */
async function recalculatePlanTotals(clinicId, planId) {
  const procedures = await TreatmentProcedure.find({
    clinicId,
    treatmentPlanId: planId,
    status: { $ne: TreatmentProcedureStatus.CANCELLED },
  }).lean();

  const prices = procedures.map((p) => p.price || 0);
  const estimatedTotal = addCents(...prices);

  await TreatmentPlan.updateOne(
    { _id: planId, clinicId },
    { $set: { estimatedTotal } }
  );

  return estimatedTotal;
}

/**
 * Create a new treatment plan with optional initial procedures.
 */
async function createTreatmentPlan(clinicId, {
  patientId,
  dentistId,
  title,
  procedures = [],
  notes = '',
  status = TreatmentPlanStatus.DRAFT,
}) {
  if (!mongoose.Types.ObjectId.isValid(patientId)) {
    throw AppError.badRequest('Invalid patientId.');
  }
  if (!mongoose.Types.ObjectId.isValid(dentistId)) {
    throw AppError.badRequest('Invalid dentistId.');
  }

  const patient = await Patient.findOne({ _id: patientId, clinicId });
  if (!patient) {
    throw AppError.notFound('Patient not found.');
  }

  const dentist = await DentistProfile.findOne({ _id: dentistId, clinicId });
  if (!dentist) {
    throw AppError.notFound('Dentist profile not found.');
  }

  if (!title || typeof title !== 'string' || !title.trim()) {
    throw AppError.badRequest('Treatment plan title is required.');
  }

  if (status && !ALL_TREATMENT_PLAN_STATUSES.includes(status)) {
    throw AppError.badRequest(`Invalid treatment plan status: '${status}'.`);
  }

  // Validate procedures if provided
  const createdProcedureIds = [];
  let totalCents = 0;

  const plan = await TreatmentPlan.create({
    clinicId,
    patientId,
    dentistId,
    title: title.trim(),
    procedures: [],
    estimatedTotal: 0,
    paidTotal: 0,
    status: status || TreatmentPlanStatus.DRAFT,
    notes: notes || '',
  });

  if (Array.isArray(procedures) && procedures.length > 0) {
    for (const proc of procedures) {
      if (proc.toothNumber !== null && proc.toothNumber !== undefined) {
        if (!isValidToothNumber(proc.toothNumber)) {
          throw AppError.badRequest(`Invalid tooth number: ${proc.toothNumber}. Must be 1-32.`);
        }
      }

      const procPrice = toCents(proc.price);
      if (procPrice < 0) {
        throw AppError.badRequest('Procedure price cannot be negative.');
      }

      const createdProc = await TreatmentProcedure.create({
        clinicId,
        treatmentPlanId: plan._id,
        toothNumber: proc.toothNumber ?? null,
        serviceId: proc.serviceId || null,
        description: proc.description || '',
        price: procPrice,
        status: proc.status || TreatmentProcedureStatus.PLANNED,
        notes: proc.notes || '',
      });

      createdProcedureIds.push(createdProc._id);
      if (createdProc.status !== TreatmentProcedureStatus.CANCELLED) {
        totalCents = addCents(totalCents, procPrice);
      }
    }

    plan.procedures = createdProcedureIds;
    plan.estimatedTotal = totalCents;
    await plan.save();
  }

  return getTreatmentPlan(clinicId, plan._id);
}

/**
 * Retrieve a treatment plan with all procedures, completion tracking,
 * financial totals, and remaining balance.
 */
async function getTreatmentPlan(clinicId, planId) {
  if (!mongoose.Types.ObjectId.isValid(planId)) {
    throw AppError.badRequest('Invalid treatmentPlanId.');
  }

  const plan = await TreatmentPlan.findOne({ _id: planId, clinicId })
    .populate('patientId', 'name patientNo phone email')
    .populate('dentistId', 'specialty licenseInfo')
    .lean();

  if (!plan) {
    throw AppError.notFound('Treatment plan not found.');
  }

  // Fetch all procedures for this plan
  const procedures = await TreatmentProcedure.find({
    clinicId,
    treatmentPlanId: planId,
  })
    .populate('serviceId', 'name category durationMinutes')
    .sort({ createdAt: 1 })
    .lean();

  // Format procedures with id field
  const formattedProcedures = procedures.map((p) => ({
    ...p,
    id: p._id,
  }));

  // Completion metrics
  const activeProcedures = formattedProcedures.filter((p) => p.status !== TreatmentProcedureStatus.CANCELLED);
  const completedProcedures = activeProcedures.filter((p) => p.status === TreatmentProcedureStatus.COMPLETED);
  const remainingProcedures = activeProcedures.filter(
    (p) => p.status === TreatmentProcedureStatus.PLANNED || p.status === TreatmentProcedureStatus.IN_PROGRESS
  );

  const totalProceduresCount = activeProcedures.length;
  const completedProceduresCount = completedProcedures.length;
  const remainingProceduresCount = remainingProcedures.length;
  const progressPercentage =
    totalProceduresCount > 0 ? Math.round((completedProceduresCount / totalProceduresCount) * 100) : 0;
  const isFullyCompleted = totalProceduresCount > 0 && remainingProceduresCount === 0;

  // Financial calculations using exact cents
  const prices = activeProcedures.map((p) => p.price || 0);
  const estimatedTotal = addCents(...prices);
  const paidTotal = plan.paidTotal || 0;
  const remainingBalance = Math.max(0, subtractCents(estimatedTotal, paidTotal));

  return {
    ...plan,
    id: plan._id,
    procedures: formattedProcedures,
    completion: {
      totalProcedures: totalProceduresCount,
      completedProcedures: completedProceduresCount,
      remainingProceduresCount,
      remainingProcedures,
      progressPercentage,
      isFullyCompleted,
    },
    financials: {
      estimatedTotal,
      paidTotal,
      remainingBalance,
    },
  };
}

/**
 * List treatment plans for a clinic with optional filters.
 */
async function listTreatmentPlans(clinicId, {
  patientId,
  dentistId,
  status,
  page = 1,
  limit = 20,
} = {}) {
  const query = { clinicId };
  if (patientId) {
    if (!mongoose.Types.ObjectId.isValid(patientId)) throw AppError.badRequest('Invalid patientId.');
    query.patientId = patientId;
  }
  if (dentistId) {
    if (!mongoose.Types.ObjectId.isValid(dentistId)) throw AppError.badRequest('Invalid dentistId.');
    query.dentistId = dentistId;
  }
  if (status) {
    if (!ALL_TREATMENT_PLAN_STATUSES.includes(status)) throw AppError.badRequest(`Invalid status: '${status}'.`);
    query.status = status;
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [plans, total] = await Promise.all([
    TreatmentPlan.find(query)
      .populate('patientId', 'name patientNo')
      .populate('dentistId', 'specialty')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    TreatmentPlan.countDocuments(query),
  ]);

  return {
    plans: plans.map((p) => ({
      ...p,
      id: p._id,
      remainingBalance: Math.max(0, subtractCents(p.estimatedTotal || 0, p.paidTotal || 0)),
    })),
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
    },
  };
}

/**
 * Update treatment plan metadata and status transitions.
 */
async function updateTreatmentPlan(clinicId, planId, { title, notes, status }) {
  if (!mongoose.Types.ObjectId.isValid(planId)) {
    throw AppError.badRequest('Invalid treatmentPlanId.');
  }

  const plan = await TreatmentPlan.findOne({ _id: planId, clinicId });
  if (!plan) {
    throw AppError.notFound('Treatment plan not found.');
  }

  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) {
      throw AppError.badRequest('Title cannot be empty.');
    }
    plan.title = title.trim();
  }

  if (notes !== undefined) {
    plan.notes = notes;
  }

  if (status !== undefined && status !== plan.status) {
    if (!ALL_TREATMENT_PLAN_STATUSES.includes(status)) {
      throw AppError.badRequest(`Invalid treatment plan status: '${status}'.`);
    }

    const allowed = VALID_PLAN_TRANSITIONS[plan.status] || [];
    if (!allowed.includes(status)) {
      throw AppError.badRequest(
        `Invalid status transition from '${plan.status}' to '${status}'. Allowed transitions: ${allowed.join(', ') || 'none'}.`
      );
    }

    // If transitioning to completed, verify all procedures are completed
    if (status === TreatmentPlanStatus.COMPLETED) {
      const activeProcedures = await TreatmentProcedure.find({
        clinicId,
        treatmentPlanId: planId,
        status: { $ne: TreatmentProcedureStatus.CANCELLED },
      }).lean();

      const incomplete = activeProcedures.filter((p) => p.status !== TreatmentProcedureStatus.COMPLETED);
      if (incomplete.length > 0) {
        throw AppError.badRequest(
          `Cannot mark treatment plan as completed: ${incomplete.length} procedure(s) are not completed.`
        );
      }
      plan.completedAt = new Date();
    }

    if (status === TreatmentPlanStatus.ACCEPTED && !plan.acceptedAt) {
      plan.acceptedAt = new Date();
    }

    plan.status = status;
  }

  await plan.save();
  return getTreatmentPlan(clinicId, planId);
}

/**
 * Add a procedure to an existing treatment plan.
 */
async function addProcedure(clinicId, planId, {
  toothNumber = null,
  serviceId = null,
  description = '',
  price,
  status = TreatmentProcedureStatus.PLANNED,
  notes = '',
}) {
  if (!mongoose.Types.ObjectId.isValid(planId)) {
    throw AppError.badRequest('Invalid treatmentPlanId.');
  }

  const plan = await TreatmentPlan.findOne({ _id: planId, clinicId });
  if (!plan) {
    throw AppError.notFound('Treatment plan not found.');
  }

  if (plan.status === TreatmentPlanStatus.COMPLETED || plan.status === TreatmentPlanStatus.REJECTED) {
    throw AppError.badRequest(`Cannot add procedures to a treatment plan in '${plan.status}' status.`);
  }

  if (toothNumber !== null && toothNumber !== undefined) {
    if (!isValidToothNumber(toothNumber)) {
      throw AppError.badRequest(`Invalid tooth number: ${toothNumber}. Must be 1-32.`);
    }
  }

  const procPrice = toCents(price);
  if (procPrice < 0) {
    throw AppError.badRequest('Procedure price cannot be negative.');
  }

  if (status && !ALL_TREATMENT_PROCEDURE_STATUSES.includes(status)) {
    throw AppError.badRequest(`Invalid procedure status: '${status}'.`);
  }

  const procedure = await TreatmentProcedure.create({
    clinicId,
    treatmentPlanId: planId,
    toothNumber: toothNumber ?? null,
    serviceId: serviceId || null,
    description: description || '',
    price: procPrice,
    status: status || TreatmentProcedureStatus.PLANNED,
    notes: notes || '',
  });

  plan.procedures.push(procedure._id);
  await plan.save();

  // Recalculate totals
  await recalculatePlanTotals(clinicId, planId);

  return procedure;
}

/**
 * Update a procedure within a treatment plan.
 */
async function updateProcedure(clinicId, planId, procedureId, updates) {
  if (!mongoose.Types.ObjectId.isValid(planId)) throw AppError.badRequest('Invalid treatmentPlanId.');
  if (!mongoose.Types.ObjectId.isValid(procedureId)) throw AppError.badRequest('Invalid procedureId.');

  const procedure = await TreatmentProcedure.findOne({
    _id: procedureId,
    treatmentPlanId: planId,
    clinicId,
  });

  if (!procedure) {
    throw AppError.notFound('Procedure not found.');
  }

  if (updates.toothNumber !== undefined) {
    if (updates.toothNumber !== null && !isValidToothNumber(updates.toothNumber)) {
      throw AppError.badRequest(`Invalid tooth number: ${updates.toothNumber}. Must be 1-32.`);
    }
    procedure.toothNumber = updates.toothNumber;
  }

  if (updates.price !== undefined) {
    const newPrice = toCents(updates.price);
    if (newPrice < 0) throw AppError.badRequest('Price cannot be negative.');
    procedure.price = newPrice;
  }

  if (updates.status !== undefined) {
    if (!ALL_TREATMENT_PROCEDURE_STATUSES.includes(updates.status)) {
      throw AppError.badRequest(`Invalid procedure status: '${updates.status}'.`);
    }
    procedure.status = updates.status;
    if (updates.status === TreatmentProcedureStatus.COMPLETED && !procedure.completedAt) {
      procedure.completedAt = new Date();
    }
  }

  if (updates.serviceId !== undefined) procedure.serviceId = updates.serviceId;
  if (updates.description !== undefined) procedure.description = updates.description;
  if (updates.notes !== undefined) procedure.notes = updates.notes;
  if (updates.scheduledAppointmentId !== undefined) procedure.scheduledAppointmentId = updates.scheduledAppointmentId;

  await procedure.save();
  await recalculatePlanTotals(clinicId, planId);

  return procedure;
}

/**
 * Mark a procedure as completed.
 */
async function completeProcedure(clinicId, planId, procedureId, { completedBy = null, completedAt = new Date() } = {}) {
  return updateProcedure(clinicId, planId, procedureId, {
    status: TreatmentProcedureStatus.COMPLETED,
    completedAt,
    completedBy,
  });
}

/**
 * Record a payment for a treatment plan with idempotency guarantee.
 */
async function recordPayment(clinicId, planId, {
  patientId,
  amount,
  method = 'cash',
  reference = '',
  idempotencyKey,
  recordedBy,
  notes = '',
}) {
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    throw AppError.badRequest('Idempotency-Key is required for financial transactions.');
  }
  if (!mongoose.Types.ObjectId.isValid(planId)) throw AppError.badRequest('Invalid treatmentPlanId.');
  const paymentAmount = toCents(amount);
  if (paymentAmount <= 0) {
    throw AppError.badRequest('Payment amount must be greater than zero.');
  }
  const key = idempotencyKey.trim();
  const requestHash = hashPayload({
    operation: 'treatmentPlan.payment',
    planId: String(planId),
    patientId: patientId ? String(patientId) : null,
    amount: paymentAmount,
    method,
    reference: reference || '',
    notes: notes || '',
  });

  const replay = async () => {
    const existingPayment = await Payment.findOne({ clinicId, idempotencyKey: key }).select('+requestHash').lean();
    if (!existingPayment) return null;
    if (existingPayment.requestHash !== requestHash) {
      throw AppError.conflict('Idempotency-Key was already used for a different payment operation.', 'IDEMPOTENCY_KEY_REUSED');
    }
    const existingPlan = await TreatmentPlan.findOne({
      _id: existingPayment.treatmentPlanId,
      clinicId,
    }).lean();
    if (!existingPlan) throw AppError.notFound('Treatment plan not found.');
    return {
      payment: Payment.hydrate(existingPayment),
      isDuplicate: true,
      remainingBalance: Math.max(0, subtractCents(existingPlan.estimatedTotal || 0, existingPlan.paidTotal || 0)),
    };
  };

  const prior = await replay();
  if (prior) return prior;

  let payment;
  let remainingBalance;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const plan = await TreatmentPlan.findOne({ _id: planId, clinicId }).session(session);
      if (!plan) throw AppError.notFound('Treatment plan not found.');

      const balance = Math.max(0, subtractCents(plan.estimatedTotal || 0, plan.paidTotal || 0));
      if (paymentAmount > balance) throw AppError.badRequest('Payment amount exceeds the treatment plan balance.', 'PAYMENT_EXCEEDS_BALANCE');

      const patient = await Patient.findOne({ _id: patientId || plan.patientId, clinicId }).session(session);
      if (!patient) throw AppError.notFound('Patient not found.');

      [payment] = await Payment.create([{
        clinicId,
        patientId: patient._id,
        treatmentPlanId: planId,
        amount: paymentAmount,
        method,
        reference: reference || '',
        idempotencyKey: key,
        requestHash,
        recordedBy,
        paidAt: new Date(),
        notes: notes || '',
      }], { session });

      const update = await TreatmentPlan.updateOne(
        { _id: planId, clinicId, paidTotal: plan.paidTotal || 0 },
        { $inc: { paidTotal: paymentAmount } },
        { session }
      );
      if (update.modifiedCount !== 1) {
        throw AppError.conflict('Treatment plan balance changed while recording payment. Retry the request.', 'PAYMENT_CONFLICT');
      }
      remainingBalance = Math.max(0, subtractCents(balance, paymentAmount));
    });
  } catch (error) {
    if (error.code === 11000) {
      const duplicate = await replay();
      if (duplicate) return duplicate;
    }
    throw error;
  } finally {
    await session.endSession();
  }

  return { payment, isDuplicate: false, remainingBalance };
}

/**
 * Get payments recorded for a treatment plan.
 */
async function getPaymentsForPlan(clinicId, planId) {
  if (!mongoose.Types.ObjectId.isValid(planId)) throw AppError.badRequest('Invalid treatmentPlanId.');

  const payments = await Payment.find({ clinicId, treatmentPlanId: planId })
    .populate('recordedBy', 'name email role')
    .sort({ paidAt: -1 })
    .lean();

  return payments;
}

module.exports = {
  createTreatmentPlan,
  getTreatmentPlan,
  listTreatmentPlans,
  updateTreatmentPlan,
  addProcedure,
  updateProcedure,
  completeProcedure,
  recordPayment,
  getPaymentsForPlan,
  recalculatePlanTotals,
};
