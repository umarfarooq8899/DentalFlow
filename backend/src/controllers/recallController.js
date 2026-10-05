'use strict';

const { z } = require('zod');
const recallService = require('../services/recallService');

const createRecallSchema = z.object({
  patientId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  dueAt: z.string().datetime(),
  nextActionAt: z.string().datetime().optional(),
  reason: z.string().trim().max(500).optional().default(''),
  notes: z.string().trim().max(2000).optional().default(''),
}).strict();

const updateRecallSchema = z.object({
  nextActionAt: z.string().datetime().optional(),
  status: z.enum(['scheduled', 'due', 'contacted', 'completed', 'cancelled']).optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict();

function getIdempotencyKey(req, res) {
  const key = req.get('Idempotency-Key');
  if (typeof key !== 'string' || !key.trim() || key.trim().length > 255) {
    res.status(400).json({ success: false, error: { code: 'MISSING_IDEMPOTENCY_KEY', message: 'A valid Idempotency-Key header is required.' } });
    return null;
  }
  return key.trim();
}

async function createRecallHandler(req, res, next) {
  try {
    const idempotencyKey = getIdempotencyKey(req, res);
    if (!idempotencyKey) return;
    const parsed = createRecallSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid recall input.', details: parsed.error.flatten() },
      });
    }
    const result = await recallService.createRecall(req.user.clinicId, { ...parsed.data, idempotencyKey });
    res.status(result.isDuplicate ? 200 : 201).json({ success: true, data: result.recall, isDuplicate: result.isDuplicate });
  } catch (error) {
    next(error);
  }
}

async function listRecallsHandler(req, res, next) {
  try {
    const result = await recallService.listRecalls(req.user.clinicId, req.query);
    res.status(200).json({ success: true, data: result.recalls, pagination: result.pagination });
  } catch (error) {
    next(error);
  }
}

async function getRecallHandler(req, res, next) {
  try {
    const recall = await recallService.getRecall(req.user.clinicId, req.params.id);
    res.status(200).json({ success: true, data: recall });
  } catch (error) {
    next(error);
  }
}

async function updateRecallHandler(req, res, next) {
  try {
    const parsed = updateRecallSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid recall update.', details: parsed.error.flatten() },
      });
    }
    const recall = await recallService.updateRecall(req.user.clinicId, req.params.id, parsed.data);
    res.status(200).json({ success: true, data: recall });
  } catch (error) {
    next(error);
  }
}

module.exports = { createRecallHandler, listRecallsHandler, getRecallHandler, updateRecallHandler };