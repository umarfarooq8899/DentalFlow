'use strict';

const { z } = require('zod');
const messageService = require('../services/messageService');

// ─── Validation Schemas ────────────────────────────────────────────────────────

const createMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message body is required').max(10000),
  senderType: z.enum(['staff', 'contact', 'system']).optional(),
  senderName: z.string().trim().max(200).optional().nullable(),
  channelMeta: z
    .object({
      subject: z.string().trim().max(300).optional().nullable(),
      externalId: z.string().trim().max(500).optional().nullable(),
      inReplyTo: z.string().trim().max(500).optional().nullable(),
    })
    .optional(),
  deliveryStatus: z
    .enum(['pending', 'sent', 'delivered', 'read', 'failed'])
    .optional(),
});

const listQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => parseInt(v || '1', 10)),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(parseInt(v || '50', 10), 100)),
  before: z.string().optional(),
  after: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

const deliveryStatusSchema = z.object({
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function createMessageHandler(req, res, next) {
  try {
    const parsed = createMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const message = await messageService.createMessage(
      req.user.clinicId,
      req.params.conversationId,
      parsed.data,
      req.user.id
    );
    res.status(201).json({ success: true, data: message });
  } catch (err) {
    next(err);
  }
}

async function getMessageHandler(req, res, next) {
  try {
    const message = await messageService.getMessage(
      req.user.clinicId,
      req.params.conversationId,
      req.params.id
    );
    res.status(200).json({ success: true, data: message });
  } catch (err) {
    next(err);
  }
}

async function listMessagesHandler(req, res, next) {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters.', details: parsed.error.flatten() },
      });
    }

    const result = await messageService.listMessages(
      req.user.clinicId,
      req.params.conversationId,
      parsed.data
    );
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function updateDeliveryStatusHandler(req, res, next) {
  try {
    const parsed = deliveryStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const message = await messageService.updateDeliveryStatus(
      req.user.clinicId,
      req.params.conversationId,
      req.params.id,
      parsed.data.status
    );
    res.status(200).json({ success: true, data: message });
  } catch (err) {
    next(err);
  }
}

async function deleteMessageHandler(req, res, next) {
  try {
    const message = await messageService.deleteMessage(
      req.user.clinicId,
      req.params.conversationId,
      req.params.id,
      req.user.id
    );
    res.status(200).json({ success: true, data: message });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createMessageHandler,
  getMessageHandler,
  listMessagesHandler,
  updateDeliveryStatusHandler,
  deleteMessageHandler,
};
