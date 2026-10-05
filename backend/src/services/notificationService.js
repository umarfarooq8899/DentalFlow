'use strict';

const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const Patient = require('../models/Patient');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const Recall = require('../models/Recall');
const AppError = require('../errors/AppError');
const env = require('../config/env');
const { enqueueNotification } = require('../jobs/notificationQueue');
const { hashPayload } = require('../utils/idempotency');

function notificationView(notification) {
  const value = notification.toObject ? notification.toObject() : { ...notification };
  value.id = String(value._id || value.id);
  delete value._id;
  delete value.__v;
  delete value.dedupeKey;
  delete value.requestHash;
  return value;
}

async function validateRecipient(clinicId, { patientId, recipientUserId, recipient, channel }) {
  if (patientId) {
    if (channel === 'in_app') throw AppError.badRequest('In-app notifications use a clinic user recipient, not patientId.');
    if (!mongoose.isValidObjectId(patientId)) throw AppError.badRequest('Invalid patientId.');
    const patient = await Patient.findOne({ _id: patientId, clinicId }).lean();
    if (!patient) throw AppError.notFound('Patient not found.');
    if (channel === 'email' && patient.email?.toLowerCase() !== recipient.toLowerCase()) {
      throw AppError.badRequest('Email recipient must match the patient email on file.');
    }
    if (channel === 'sms' && patient.phone !== recipient) {
      throw AppError.badRequest('SMS recipient must match the patient phone on file.');
    }
    return patient;
  }

  if (channel !== 'in_app' || !mongoose.isValidObjectId(recipientUserId)) {
    throw AppError.badRequest('Patient notifications or an in-app recipient user are required.');
  }
  const user = await User.findOne({ _id: recipientUserId, clinicId }).lean();
  if (!user || String(user._id) !== String(recipient)) throw AppError.notFound('Notification recipient not found.');
  return null;
}

async function createNotification(clinicId, data) {
  const requestHash = hashPayload({
    patientId: data.patientId ? String(data.patientId) : null,
    recipientUserId: data.recipientUserId ? String(data.recipientUserId) : null,
    recipient: data.recipient,
    channel: data.channel,
    subject: data.subject || '',
    message: data.message,
    scheduledAt: data.idempotencyScheduledAt === null
      ? null
      : new Date(data.scheduledAt).toISOString(),
    relatedResourceType: data.relatedResourceType || null,
    relatedResourceId: data.relatedResourceId ? String(data.relatedResourceId) : null,
  });
  const existing = await Notification.findOne({ clinicId, dedupeKey: data.dedupeKey }).select('+requestHash').lean();
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw AppError.conflict('Idempotency-Key was already used for a different notification.', 'IDEMPOTENCY_KEY_REUSED');
    }
    if (existing.status === 'queued') await enqueueNotification(existing);
    return { notification: notificationView(existing), isDuplicate: true };
  }

  await validateRecipient(clinicId, data);
  let notification;
  try {
    const { idempotencyScheduledAt, ...notificationData } = data;
    notification = await Notification.create({ ...notificationData, clinicId, requestHash, status: 'queued' });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const duplicate = await Notification.findOne({ clinicId, dedupeKey: data.dedupeKey }).select('+requestHash').lean();
    if (!duplicate) throw error;
    if (duplicate.requestHash !== requestHash) {
      throw AppError.conflict('Idempotency-Key was already used for a different notification.', 'IDEMPOTENCY_KEY_REUSED');
    }
    if (duplicate.status === 'queued') await enqueueNotification(duplicate);
    return { notification: notificationView(duplicate), isDuplicate: true };
  }

  await enqueueNotification(notification);
  return { notification: notificationView(notification), isDuplicate: false };
}

async function createAppointmentReminder(clinicId, appointment) {
  const currentAppointment = await Appointment.findOne({ _id: appointment._id, clinicId }).lean();
  if (!currentAppointment || !['scheduled', 'confirmed'].includes(currentAppointment.status)) return null;
  const patient = await Patient.findOne({ _id: currentAppointment.patientId, clinicId }).lean();
  if (!patient) return null;

  const channel = patient.email ? 'email' : patient.phone ? 'sms' : null;
  if (!channel) {
    await Appointment.updateOne({ _id: currentAppointment._id, clinicId }, { $set: { reminderState: 'suppressed' } });
    return null;
  }

  const recipient = channel === 'email' ? patient.email : patient.phone;
  const startAt = new Date(currentAppointment.startAt);
  const configuredLead = Number.isInteger(env.APPOINTMENT_REMINDER_LEAD_HOURS)
    ? Math.max(0, env.APPOINTMENT_REMINDER_LEAD_HOURS)
    : 24;
  const reminderTime = startAt.getTime() - configuredLead * 60 * 60 * 1000;
  const formattedStart = startAt.toISOString();
  const result = await createNotification(clinicId, {
    recipient,
    patientId: patient._id,
    channel,
    subject: channel === 'email' ? 'Appointment reminder' : '',
    message: `Reminder: you have a dental appointment scheduled for ${formattedStart}.`,
    scheduledAt: new Date(reminderTime),
    dedupeKey: `appointment-reminder:${currentAppointment._id}:${startAt.getTime()}`,
    relatedResourceType: 'appointment',
    relatedResourceId: currentAppointment._id,
  });
  await Appointment.updateOne({ _id: currentAppointment._id, clinicId }, { $set: { reminderState: 'pending' } });
  return result.notification;
}

async function listNotifications(clinicId, { patientId, status, page = 1, limit = 20 } = {}) {
  const query = { clinicId };
  if (patientId) {
    if (!mongoose.isValidObjectId(patientId)) throw AppError.badRequest('Invalid patientId.');
    query.patientId = patientId;
  }
  if (status) {
    if (!['queued', 'processing', 'sent', 'failed', 'cancelled'].includes(status)) {
      throw AppError.badRequest('Invalid notification status.');
    }
    query.status = status;
  }
  const pageNumber = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const [notifications, total] = await Promise.all([
    Notification.find(query).sort({ scheduledAt: -1 }).skip((pageNumber - 1) * pageSize).limit(pageSize).lean(),
    Notification.countDocuments(query),
  ]);
  return {
    notifications: notifications.map(notificationView),
    pagination: { total, page: pageNumber, limit: pageSize, pages: Math.ceil(total / pageSize) },
  };
}

async function getNotification(clinicId, notificationId) {
  if (!mongoose.isValidObjectId(notificationId)) throw AppError.notFound('Notification not found.');
  const notification = await Notification.findOne({ _id: notificationId, clinicId }).lean();
  if (!notification) throw AppError.notFound('Notification not found.');
  return notificationView(notification);
}

async function processNotificationJob({ clinicId, notificationId }, deliver) {
  const notification = await Notification.findOne({ _id: notificationId, clinicId });
  if (!notification) throw AppError.notFound('Notification not found.');
  if (['sent', 'cancelled'].includes(notification.status)) return { skipped: true };

  if (notification.relatedResourceType === 'appointment') {
    const appointment = await Appointment.findOne({
      _id: notification.relatedResourceId,
      clinicId,
      status: { $in: ['scheduled', 'confirmed'] },
    }).lean();
    const notificationStartAt = Number(notification.dedupeKey.split(':').at(-1));
    if (!appointment || new Date(appointment.startAt).getTime() !== notificationStartAt) {
      notification.status = 'cancelled';
      await notification.save();
      return { skipped: true, reason: 'stale_appointment_reminder' };
    }
  }

  if (notification.relatedResourceType === 'recall') {
    const recall = await Recall.findOne({
      _id: notification.relatedResourceId,
      clinicId,
      status: { $nin: ['completed', 'cancelled'] },
    }).lean();
    const notificationActionAt = Number(notification.dedupeKey.split(':').at(-1));
    if (!recall || new Date(recall.nextActionAt).getTime() !== notificationActionAt) {
      notification.status = 'cancelled';
      await notification.save();
      return { skipped: true, reason: 'inactive_recall' };
    }
  }

  notification.status = 'processing';
  notification.attempts += 1;
  notification.error = { code: null, message: null, at: null };
  await notification.save();

  await deliver(notificationView(notification));

  notification.status = 'sent';
  notification.sentAt = new Date();
  notification.failedAt = null;
  await notification.save();

  if (notification.relatedResourceType === 'appointment') {
    await Appointment.updateOne({ _id: notification.relatedResourceId, clinicId }, { $set: { reminderState: 'sent' } });
  } else if (notification.relatedResourceType === 'recall') {
    await Recall.updateOne(
      { _id: notification.relatedResourceId, clinicId, status: { $nin: ['completed', 'cancelled'] } },
      { $set: { status: 'contacted', lastContactedAt: new Date() } }
    );
  }
  return { sent: true };
}

async function requeuePendingNotifications() {
  const cursor = Notification.find({ status: 'queued' }).lean().cursor();
  for await (const notification of cursor) {
    await enqueueNotification(notification);
  }
}

async function schedulePendingAppointmentReminders() {
  const cursor = Appointment.find({
    status: { $in: ['scheduled', 'confirmed'] },
    startAt: { $gt: new Date() },
    reminderState: 'pending',
  }).lean().cursor();
  for await (const appointment of cursor) {
    try {
      await createAppointmentReminder(appointment.clinicId, appointment);
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'appointment.reminder_recovery_failed',
        appointmentId: String(appointment._id),
        errorName: error.name,
        errorCode: error.code || null,
      }));
    }
  }
}

async function markNotificationAttemptFailed({ clinicId, notificationId }, error, terminal) {
  await Notification.updateOne(
    { _id: notificationId, clinicId, status: { $ne: 'sent' } },
    {
      $set: {
        status: terminal ? 'failed' : 'queued',
        failedAt: new Date(),
        error: { code: error?.code || 'DELIVERY_FAILED', message: 'Notification delivery failed.', at: new Date() },
      },
    }
  );
}

module.exports = {
  createNotification,
  createAppointmentReminder,
  listNotifications,
  getNotification,
  processNotificationJob,
  requeuePendingNotifications,
  schedulePendingAppointmentReminders,
  markNotificationAttemptFailed,
};