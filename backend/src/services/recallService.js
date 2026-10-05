'use strict';

const mongoose = require('mongoose');
const Recall = require('../models/Recall');
const Patient = require('../models/Patient');
const AppError = require('../errors/AppError');
const notificationService = require('./notificationService');
const { hashPayload } = require('../utils/idempotency');

const RECALL_TRANSITIONS = {
  scheduled: ['due', 'contacted', 'completed', 'cancelled'],
  due: ['scheduled', 'contacted', 'completed', 'cancelled'],
  contacted: ['scheduled', 'due', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

function requireIdempotencyKey(key) {
  if (typeof key !== 'string' || !key.trim() || key.trim().length > 255) {
    throw AppError.badRequest('A valid Idempotency-Key header is required.', 'MISSING_IDEMPOTENCY_KEY');
  }
  return key.trim();
}

function recallView(recall) {
  const value = recall.toObject ? recall.toObject() : { ...recall };
  value.id = String(value._id || value.id);
  delete value._id;
  delete value.__v;
  delete value.idempotencyKey;
  return value;
}

async function scheduleRecallNotification(clinicId, recall) {
  const patient = await Patient.findOne({ _id: recall.patientId, clinicId }).lean();
  if (!patient) return null;
  const channel = patient.email ? 'email' : patient.phone ? 'sms' : null;
  if (!channel) return null;
  const recipient = channel === 'email' ? patient.email : patient.phone;
  const result = await notificationService.createNotification(clinicId, {
    recipient,
    patientId: patient._id,
    channel,
    subject: channel === 'email' ? 'Dental care recall' : '',
    message: recall.reason || 'It is time to schedule your next dental visit.',
    scheduledAt: recall.nextActionAt,
    dedupeKey: `recall:${recall._id}:${new Date(recall.nextActionAt).getTime()}`,
    relatedResourceType: 'recall',
    relatedResourceId: recall._id,
  });
  return result.notification;
}

async function createRecall(clinicId, { patientId, dueAt, nextActionAt, reason = '', notes = '', idempotencyKey }) {
  if (!mongoose.isValidObjectId(patientId)) throw AppError.badRequest('Invalid patientId.');
  const key = requireIdempotencyKey(idempotencyKey);
  const parsedDueAt = new Date(dueAt);
  const parsedNextActionAt = nextActionAt ? new Date(nextActionAt) : parsedDueAt;
  if (!Number.isFinite(parsedDueAt.getTime()) || !Number.isFinite(parsedNextActionAt.getTime())) {
    throw AppError.badRequest('dueAt and nextActionAt must be valid dates.');
  }

  const requestHash = hashPayload({
    patientId: String(patientId),
    dueAt: parsedDueAt.toISOString(),
    nextActionAt: parsedNextActionAt.toISOString(),
    reason,
    notes,
  });
  const existing = await Recall.findOne({ clinicId, idempotencyKey: key }).select('+requestHash');
  if (existing && existing.requestHash !== requestHash) {
    throw AppError.conflict('Idempotency-Key was already used for a different recall.', 'IDEMPOTENCY_KEY_REUSED');
  }
  if (existing) {
    if (!['completed', 'cancelled'].includes(existing.status)) await scheduleRecallNotification(clinicId, existing);
    return { recall: recallView(existing), isDuplicate: true };
  }
  const patient = await Patient.findOne({ _id: patientId, clinicId }).lean();
  if (!patient) throw AppError.notFound('Patient not found.');

  let recall;
  try {
    recall = await Recall.create({
      clinicId,
      patientId,
      dueAt: parsedDueAt,
      nextActionAt: parsedNextActionAt,
      status: parsedNextActionAt <= new Date() ? 'due' : 'scheduled',
      reason,
      notes,
      idempotencyKey: key,
      requestHash,
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const duplicate = await Recall.findOne({ clinicId, idempotencyKey: key }).select('+requestHash');
    if (!duplicate) throw error;
    if (duplicate.requestHash !== requestHash) {
      throw AppError.conflict('Idempotency-Key was already used for a different recall.', 'IDEMPOTENCY_KEY_REUSED');
    }
    if (!['completed', 'cancelled'].includes(duplicate.status)) await scheduleRecallNotification(clinicId, duplicate);
    return { recall: recallView(duplicate), isDuplicate: true };
  }

  await scheduleRecallNotification(clinicId, recall);
  return { recall: recallView(recall), isDuplicate: false };
}

async function getRecall(clinicId, recallId) {
  if (!mongoose.isValidObjectId(recallId)) throw AppError.notFound('Recall not found.');
  const recall = await Recall.findOne({ _id: recallId, clinicId }).lean();
  if (!recall) throw AppError.notFound('Recall not found.');
  return recallView(recall);
}

async function listRecalls(clinicId, { patientId, status, page = 1, limit = 20 } = {}) {
  const query = { clinicId };
  if (patientId) {
    if (!mongoose.isValidObjectId(patientId)) throw AppError.badRequest('Invalid patientId.');
    query.patientId = patientId;
  }
  if (status) {
    if (!['scheduled', 'due', 'contacted', 'completed', 'cancelled'].includes(status)) {
      throw AppError.badRequest('Invalid recall status.');
    }
    query.status = status;
  }
  const pageNumber = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const [recalls, total] = await Promise.all([
    Recall.find(query).populate('patientId', 'name patientNo phone email')
      .sort({ nextActionAt: 1 }).skip((pageNumber - 1) * pageSize).limit(pageSize).lean(),
    Recall.countDocuments(query),
  ]);
  return {
    recalls: recalls.map(recallView),
    pagination: { total, page: pageNumber, limit: pageSize, pages: Math.ceil(total / pageSize) },
  };
}

async function updateRecall(clinicId, recallId, updates) {
  if (!mongoose.isValidObjectId(recallId)) throw AppError.notFound('Recall not found.');
  const recall = await Recall.findOne({ _id: recallId, clinicId });
  if (!recall) throw AppError.notFound('Recall not found.');
  if (updates.status && updates.status !== recall.status) {
    if (!RECALL_TRANSITIONS[recall.status]?.includes(updates.status)) {
      throw AppError.badRequest(`Invalid recall status transition from '${recall.status}' to '${updates.status}'.`, 'INVALID_STATUS_TRANSITION');
    }
    recall.status = updates.status;
    if (updates.status === 'contacted') recall.lastContactedAt = new Date();
  }
  if (updates.nextActionAt !== undefined) {
    const date = new Date(updates.nextActionAt);
    if (!Number.isFinite(date.getTime())) throw AppError.badRequest('nextActionAt must be a valid date.');
    recall.nextActionAt = date;
    if (['due', 'contacted'].includes(recall.status)) recall.status = date <= new Date() ? 'due' : 'scheduled';
  }
  if (updates.notes !== undefined) recall.notes = updates.notes;
  await recall.save();
  if (!['completed', 'cancelled'].includes(recall.status)) await scheduleRecallNotification(clinicId, recall);
  return recallView(recall);
}

async function scheduleActiveRecallNotifications() {
  const cursor = Recall.find({ status: { $in: ['scheduled', 'due', 'contacted'] } }).lean().cursor();
  for await (const recall of cursor) {
    try {
      await scheduleRecallNotification(recall.clinicId, { ...recall, id: recall._id });
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'recall.notification_recovery_failed',
        recallId: String(recall._id),
        errorName: error.name,
        errorCode: error.code || null,
      }));
    }
  }
}

module.exports = {
  createRecall,
  getRecall,
  listRecalls,
  updateRecall,
  scheduleRecallNotification,
  scheduleActiveRecallNotifications,
};