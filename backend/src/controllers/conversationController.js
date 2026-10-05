'use strict';

const { z } = require('zod');
const conversationService = require('../services/conversationService');

// ─── Validation Schemas ────────────────────────────────────────────────────────

const participantSchema = z.object({
  userId: z.string().optional().nullable(),
  role: z.enum(['staff', 'contact']).optional(),
  displayName: z.string().trim().max(200).optional().nullable(),
});

const channelMetaSchema = z.object({
  externalId: z.string().trim().max(300).optional().nullable(),
  from: z.string().trim().max(320).optional().nullable(),
  to: z.string().trim().max(320).optional().nullable(),
}).optional();

const createConversationSchema = z.object({
  channel: z.enum(['sms', 'email', 'whatsapp', 'in_app', 'phone_note']),
  subject: z.string().trim().max(300).optional().nullable(),
  leadId: z.string().optional().nullable(),
  patientId: z.string().optional().nullable(),
  participants: z.array(participantSchema).optional(),
  channelMeta: channelMetaSchema,
});

const listQuerySchema = z.object({
  status: z.enum(['open', 'closed', 'archived']).optional(),
  channel: z.enum(['sms', 'email', 'whatsapp', 'in_app', 'phone_note']).optional(),
  leadId: z.string().optional(),
  patientId: z.string().optional(),
  page: z
    .string()
    .optional()
    .transform((v) => parseInt(v || '1', 10)),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(parseInt(v || '20', 10), 100)),
  sortBy: z.enum(['createdAt', 'lastMessageAt', 'status']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

const statusSchema = z.object({
  status: z.enum(['open', 'closed', 'archived']),
});

const addParticipantSchema = z.object({
  userId: z.string().optional().nullable(),
  role: z.enum(['staff', 'contact']).optional(),
  displayName: z.string().trim().max(200).optional().nullable(),
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function createConversationHandler(req, res, next) {
  try {
    const parsed = createConversationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const conversation = await conversationService.createConversation(
      req.user.clinicId,
      parsed.data,
      req.user.id
    );
    res.status(201).json({ success: true, data: conversation });
  } catch (err) {
    next(err);
  }
}

async function getConversationHandler(req, res, next) {
  try {
    const conversation = await conversationService.getConversation(
      req.user.clinicId,
      req.params.id
    );
    res.status(200).json({ success: true, data: conversation });
  } catch (err) {
    next(err);
  }
}

async function listConversationsHandler(req, res, next) {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters.', details: parsed.error.flatten() },
      });
    }

    const result = await conversationService.listConversations(req.user.clinicId, parsed.data);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function updateConversationStatusHandler(req, res, next) {
  try {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const conversation = await conversationService.updateConversationStatus(
      req.user.clinicId,
      req.params.id,
      parsed.data.status
    );
    res.status(200).json({ success: true, data: conversation });
  } catch (err) {
    next(err);
  }
}

async function addParticipantHandler(req, res, next) {
  try {
    const parsed = addParticipantSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const conversation = await conversationService.addParticipant(
      req.user.clinicId,
      req.params.id,
      parsed.data
    );
    res.status(200).json({ success: true, data: conversation });
  } catch (err) {
    next(err);
  }
}

async function removeParticipantHandler(req, res, next) {
  try {
    const conversation = await conversationService.removeParticipant(
      req.user.clinicId,
      req.params.id,
      req.params.participantId
    );
    res.status(200).json({ success: true, data: conversation });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createConversationHandler,
  getConversationHandler,
  listConversationsHandler,
  updateConversationStatusHandler,
  addParticipantHandler,
  removeParticipantHandler,
};
