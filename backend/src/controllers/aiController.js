'use strict';

const { z } = require('zod');
const aiService = require('../services/aiService');

// ─── Validation Schemas ───────────────────────────────────────────────────────

const reviewAIJobSchema = z.object({
  action: z.enum(['approved', 'rejected', 'modified']),
  notes: z.string().trim().max(1000).optional(),
  modifiedReply: z.string().trim().min(1).max(3000).optional(),
});

const previewRedactionSchema = z.object({
  text: z.string().min(1, 'Text to redact is required'),
  knownEntities: z
    .object({
      names: z.array(z.string()).optional(),
      phones: z.array(z.string()).optional(),
      emails: z.array(z.string()).optional(),
      addresses: z.array(z.string()).optional(),
    })
    .optional(),
});

const listJobsQuerySchema = z.object({
  status: z.enum(['pending', 'in_review', 'approved', 'rejected', 'completed', 'failed']).optional(),
  jobType: z.enum(['lead_scoring', 'suggested_reply']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

// ─── Controller Handlers ──────────────────────────────────────────────────────

async function scoreLeadHandler(req, res, next) {
  try {
    const { leadId } = req.params;
    const result = await aiService.scoreLead(req.user.clinicId, leadId, req.body);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function suggestReplyHandler(req, res, next) {
  try {
    const { conversationId } = req.params;
    const result = await aiService.generateSuggestedReply(
      req.user.clinicId,
      conversationId,
      req.body
    );
    // Returns 200 with the draft job in 'in_review' status
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function reviewAIJobHandler(req, res, next) {
  try {
    const { id } = req.params;
    const validated = reviewAIJobSchema.parse(req.body);
    const result = await aiService.reviewAIJob(
      req.user.clinicId,
      id,
      validated,
      req.user.id || req.user.userId
    );
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function getAIJobHandler(req, res, next) {
  try {
    const { id } = req.params;
    const result = await aiService.getAIJob(req.user.clinicId, id);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function listAIJobsHandler(req, res, next) {
  try {
    const validated = listJobsQuerySchema.parse(req.query);
    const result = await aiService.listAIJobs(req.user.clinicId, validated);
    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
}

async function previewRedactionHandler(req, res, next) {
  try {
    const validated = previewRedactionSchema.parse(req.body);
    const result = aiService.previewRedaction(validated.text, validated.knownEntities);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  scoreLeadHandler,
  suggestReplyHandler,
  reviewAIJobHandler,
  getAIJobHandler,
  listAIJobsHandler,
  previewRedactionHandler,
};
