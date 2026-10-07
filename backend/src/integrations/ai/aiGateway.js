'use strict';

const AIJob = require('../../models/AIJob');
const { PIIRedactor, rehydrate } = require('./piiRedactor');
const { getActiveProvider } = require('./providers');
const { parseAndValidateOutput } = require('./validators');
const aiLogger = require('./sanitizerLogger');
const AppError = require('../../errors/AppError');

// Prohibited medical/clinical action keywords to prevent autonomous clinical decisions
const PROHIBITED_JOB_TYPES = new Set([
  'clinical_diagnosis',
  'prescription',
  'treatment_decision',
  'chart_mutation',
  'autonomous_message_dispatch',
]);

/**
 * AI Gateway
 *
 * Single entry point for all AI capabilities in the application.
 * Enforces the strict pipeline:
 * Application → AI Gateway → PII Redaction → LLM Provider → Output Validation → Re-hydration → Human Review
 */
class AIGateway {
  /**
   * Process a request through the secure AI pipeline.
   *
   * @param {object} params
   * @param {string} params.clinicId - The tenant clinic ID.
   * @param {'lead_scoring' | 'suggested_reply'} params.jobType - Type of administrative AI job.
   * @param {string} params.rawPrompt - The raw unredacted prompt containing patient/lead context.
   * @param {string} [params.systemPrompt] - System instructions.
   * @param {object} [params.knownEntities] - Explicit domain entities to redact: { names, phones, emails, addresses }.
   * @param {string} [params.leadId] - Associated lead ID.
   * @param {string} [params.conversationId] - Associated conversation ID.
   * @param {string} [params.model] - Target model identifier.
   * @param {number} [params.timeoutMs] - Provider timeout in ms (default 10000).
   * @returns {Promise<import('../../models/AIJob')>}
   */
  static async executeJob(params) {
    const {
      clinicId,
      jobType,
      rawPrompt,
      systemPrompt,
      knownEntities = {},
      leadId = null,
      conversationId = null,
      model = 'mock-llm-v1',
      timeoutMs = 10000,
    } = params;

    // ── 1. Security Boundary Check ──────────────────────────────────────────
    if (PROHIBITED_JOB_TYPES.has(jobType)) {
      aiLogger.error('Prohibited AI job attempted', { jobType, clinicId });
      throw AppError.forbidden(
        'AI is strictly restricted to administrative/CRM domains. Autonomous clinical diagnosis, prescription, or clinical decisions are prohibited.',
        'AI_CLINICAL_ACTION_PROHIBITED'
      );
    }

    if (!rawPrompt || typeof rawPrompt !== 'string' || !rawPrompt.trim()) {
      throw AppError.badRequest('A prompt must be provided for the AI job.', 'VALIDATION_ERROR');
    }

    // ── 2. PII Redaction Engine ─────────────────────────────────────────────
    const redactor = new PIIRedactor();
    const { redactedText, tokens, piiStripped, count: redactionCount } = redactor.redact(
      rawPrompt,
      knownEntities
    );

    // Redact system prompt as well if provided
    let redactedSystemPrompt = systemPrompt;
    if (systemPrompt && typeof systemPrompt === 'string') {
      const redSys = redactor.redact(systemPrompt, knownEntities);
      redactedSystemPrompt = redSys.redactedText;
    }

    // Safe log: Never log rawPrompt or tokens
    aiLogger.info('PII Redaction complete', {
      clinicId,
      jobType,
      piiStripped,
      redactionCount,
      // Only token count logged, never the identity map
    });

    const provider = getActiveProvider();

    // ── 3. Provider Call & Output Validation Pipeline ────────────────────────
    let rawOutputContent = null;
    let validatedOutput = null;
    let rehydratedOutput = null;
    let jobStatus = jobType === 'suggested_reply' ? 'in_review' : 'completed';
    let executionError = null;

    try {
      // THE PROVIDER RECEIVES ONLY THE REDACTED TEXT.
      // THE TOKENS MAPPING NEVER LEAVES OUR BOUNDARY.
      const providerResult = await provider.generateCompletion({
        prompt: redactedText,
        systemPrompt: redactedSystemPrompt,
        jobType,
        model,
        timeoutMs,
      });

      rawOutputContent = providerResult.content;

      // ── 4. Output Schema Validation ─────────────────────────────────────────
      validatedOutput = parseAndValidateOutput(rawOutputContent, jobType);

      // ── 5. Re-hydration Engine ──────────────────────────────────────────────
      // Replace tokens with original values for internal human consumption
      rehydratedOutput = rehydrate(validatedOutput, tokens);
    } catch (err) {
      jobStatus = 'failed';
      executionError = {
        code: err.code || 'AI_EXECUTION_ERROR',
        message: err.message || 'AI Provider execution failed',
        details: err.details || null,
      };

      aiLogger.warn('AI Provider execution failed', {
        clinicId,
        jobType,
        errorCode: executionError.code,
      });

      // Create failed AIJob record for auditing and transparency
      const failedJob = await AIJob.create({
        clinicId,
        jobType,
        redactedInput: redactedText,
        piiStripped,
        redactionCount,
        output: null,
        rehydratedOutput: null,
        model,
        provider: provider.name,
        providerRegion: provider.region,
        status: 'failed',
        leadId,
        conversationId,
        error: executionError,
        identityMap: tokens,
      });

      // Propagate error with proper status code
      if (err instanceof AppError) {
        throw err;
      }
      const targetStatus = err.statusCode || err.status || 502;
      const wrappedError = new AppError(
        executionError.message,
        targetStatus,
        executionError.code,
        executionError.details
      );
      throw wrappedError;
    }

    // ── 6. Create AIJob Record ────────────────────────────────────────────────
    const aiJob = await AIJob.create({
      clinicId,
      jobType,
      redactedInput: redactedText,
      piiStripped,
      redactionCount,
      output: validatedOutput,
      rehydratedOutput,
      model,
      provider: provider.name,
      providerRegion: provider.region,
      status: jobStatus,
      leadId,
      conversationId,
      error: null,
      identityMap: tokens,
    });

    return aiJob;
  }
}

module.exports = AIGateway;
