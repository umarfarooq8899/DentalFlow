'use strict';

const { z } = require('zod');
const AppError = require('../../errors/AppError');

// ── Lead Scoring Schema ───────────────────────────────────────────────────────
const leadScoringOutputSchema = z.object({
  score: z.number().min(0).max(100),
  intent: z.string().min(1),
  urgency: z.string().min(1),
  recommendedActions: z.array(z.string()).default([]),
  rationale: z.string().min(1),
});

// ── Suggested Reply Schema ────────────────────────────────────────────────────
const suggestedReplyOutputSchema = z.object({
  suggestedReply: z.string().min(1).max(3000),
  intent: z.string().min(1),
  confidence: z.number().min(0).max(1),
  keyPoints: z.array(z.string()).default([]),
});

const SCHEMAS = {
  lead_scoring: leadScoringOutputSchema,
  suggested_reply: suggestedReplyOutputSchema,
};

/**
 * Parses and validates raw LLM text against the target schema.
 * Extracts JSON even if wrapped in markdown codeblocks (e.g. ```json ... ```).
 *
 * @param {string} rawContent - Raw text output from LLM provider.
 * @param {'lead_scoring' | 'suggested_reply'} jobType - The target job type.
 * @returns {object} The validated structured output.
 */
function parseAndValidateOutput(rawContent, jobType) {
  const schema = SCHEMAS[jobType];
  if (!schema) {
    throw AppError.badRequest(`Unknown AI job type validator: ${jobType}`, 'AI_VALIDATION_ERROR');
  }

  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    throw AppError.badRequest('Provider returned empty output.', 'AI_MALFORMED_OUTPUT');
  }

  // Strip optional markdown fencing: ```json ... ```
  let cleaned = rawContent.trim();
  const codeBlockRegex = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
  const match = cleaned.match(codeBlockRegex);
  if (match) {
    cleaned = match[1].trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw AppError.badRequest(
      `Malformed JSON in provider response: ${err.message}`,
      'AI_MALFORMED_OUTPUT',
      { rawContent: cleaned.slice(0, 200) }
    );
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw AppError.badRequest(
      'Provider response did not conform to expected schema.',
      'AI_INVALID_OUTPUT',
      result.error.flatten()
    );
  }

  return result.data;
}

module.exports = {
  leadScoringOutputSchema,
  suggestedReplyOutputSchema,
  parseAndValidateOutput,
};
