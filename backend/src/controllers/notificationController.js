'use strict';

const { z } = require('zod');
const notificationService = require('../services/notificationService');

const createNotificationSchema = z.object({
  patientId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  recipientUserId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  recipient: z.string().trim().min(1).max(320),
  channel: z.enum(['email', 'sms', 'in_app']),
  subject: z.string().trim().max(200).optional().default(''),
  message: z.string().trim().min(1).max(5000),
  scheduledAt: z.string().datetime().optional(),
}).strict();

function getDedupeKey(req, res) {
  const key = req.get('Idempotency-Key');
  if (typeof key !== 'string' || !key.trim() || key.trim().length > 250) {
    res.status(400).json({ success: false, error: { code: 'MISSING_IDEMPOTENCY_KEY', message: 'A valid Idempotency-Key header is required.' } });
    return null;
  }
  return key.trim();
}

async function createNotificationHandler(req, res, next) {
  try {
    const dedupeKey = getDedupeKey(req, res);
    if (!dedupeKey) return;
    const parsed = createNotificationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid notification input.', details: parsed.error.flatten() },
      });
    }
    const result = await notificationService.createNotification(req.user.clinicId, {
      ...parsed.data,
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : new Date(),
      idempotencyScheduledAt: parsed.data.scheduledAt || null,
      dedupeKey,
    });
    res.status(result.isDuplicate ? 200 : 202).json({ success: true, data: result.notification, isDuplicate: result.isDuplicate });
  } catch (error) {
    next(error);
  }
}

async function listNotificationsHandler(req, res, next) {
  try {
    const result = await notificationService.listNotifications(req.user.clinicId, req.query);
    res.status(200).json({ success: true, data: result.notifications, pagination: result.pagination });
  } catch (error) {
    next(error);
  }
}

async function getNotificationHandler(req, res, next) {
  try {
    const notification = await notificationService.getNotification(req.user.clinicId, req.params.id);
    res.status(200).json({ success: true, data: notification });
  } catch (error) {
    next(error);
  }
}

module.exports = { createNotificationHandler, listNotificationsHandler, getNotificationHandler };