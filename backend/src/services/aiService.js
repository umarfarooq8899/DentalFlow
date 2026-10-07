'use strict';

const mongoose = require('mongoose');
const AIJob = require('../models/AIJob');
const Lead = require('../models/Lead');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const AIGateway = require('../integrations/ai/aiGateway');
const { PIIRedactor } = require('../integrations/ai/piiRedactor');
const AppError = require('../errors/AppError');

/**
 * AI Domain Service
 *
 * Implements business use-cases for AI-assisted workflows:
 * Lead Scoring, Suggested Replies, and Human Review.
 */

// ─── Lead Scoring ─────────────────────────────────────────────────────────────

/**
 * Run AI-assisted lead scoring on a given lead.
 *
 * @param {string} clinicId
 * @param {string} leadId
 * @param {object} [opts]
 */
async function scoreLead(clinicId, leadId, opts = {}) {
  if (!mongoose.isValidObjectId(leadId)) {
    throw AppError.badRequest('Invalid leadId format.', 'VALIDATION_ERROR');
  }

  const lead = await Lead.findOne({ _id: leadId, clinicId });
  if (!lead) {
    throw AppError.notFound('Lead not found.', 'LEAD_NOT_FOUND');
  }

  // Construct raw prompt containing all relevant context
  const notesText =
    typeof lead.notes === 'string'
      ? lead.notes
      : Array.isArray(lead.notes)
      ? lead.notes.map((n) => (typeof n === 'string' ? n : n.text)).join('\n')
      : '';

  const rawPrompt = `
Please score this incoming dental clinic lead based on intent, urgency, and procedure likelihood.

Lead Details:
- Name: ${lead.name}
- Email: ${lead.email || 'N/A'}
- Phone: ${lead.phone || 'N/A'}
- Source: ${lead.source || 'website'}
- Current Status: ${lead.status}
- Notes and Inquiries:
${notesText || 'No notes available.'}

Return a structured JSON with:
score (0-100), intent ("high"|"medium"|"low"), urgency ("emergency"|"urgent"|"routine"|"low"), recommendedActions (array of strings), and rationale (string).
`.trim();

  const knownEntities = {
    names: lead.name ? [lead.name] : [],
    phones: lead.phone ? [lead.phone] : [],
    emails: lead.email ? [lead.email] : [],
  };

  const aiJob = await AIGateway.executeJob({
    clinicId,
    jobType: 'lead_scoring',
    rawPrompt,
    knownEntities,
    leadId: lead._id,
    model: opts.model || 'mock-llm-v1',
  });

  return aiJob;
}

// ─── Suggested Replies ────────────────────────────────────────────────────────

/**
 * Generate an AI suggested reply for an ongoing conversation.
 * The output ALWAYS starts in 'in_review' status (DRAFT) until approved by staff.
 *
 * @param {string} clinicId
 * @param {string} conversationId
 * @param {object} [opts]
 */
async function generateSuggestedReply(clinicId, conversationId, opts = {}) {
  if (!mongoose.isValidObjectId(conversationId)) {
    throw AppError.badRequest('Invalid conversationId format.', 'VALIDATION_ERROR');
  }

  const conversation = await Conversation.findOne({ _id: conversationId, clinicId });
  if (!conversation) {
    throw AppError.notFound('Conversation not found.', 'CONVERSATION_NOT_FOUND');
  }

  // Fetch recent messages for conversational context
  const messages = await Message.find({
    conversationId: conversation._id,
    clinicId,
    deletedAt: null,
  })
    .sort({ createdAt: 1 })
    .limit(20)
    .lean();

  if (messages.length === 0) {
    throw AppError.badRequest('Conversation has no messages to reply to.', 'NO_MESSAGES_FOUND');
  }

  // Collect known names and contact info from participants and messages to ensure redaction
  const knownNames = [];
  const knownPhones = [];
  const knownEmails = [];

  for (const p of conversation.participants || []) {
    if (p.name) knownNames.push(p.name);
  }
  for (const m of messages) {
    if (m.senderName) knownNames.push(m.senderName);
  }

  // Build conversation transcript prompt
  const transcript = messages
    .map((m) => `${m.senderName || m.senderType} (${m.channel}): ${m.body}`)
    .join('\n');

  const rawPrompt = `
Generate a professional, polite, and helpful draft response from the dental clinic staff to the contact.

Conversation Channel: ${conversation.channel}
Recent Conversation History:
${transcript}

Context Notes: ${opts.contextNotes || 'Standard clinic reply'}

Requirements:
- Professional and empathetic tone
- Do NOT provide medical diagnosis or prescribe medication
- Propose convenient appointment slots or address queries
- Structured JSON format with suggestedReply, intent, confidence, keyPoints.
`.trim();

  const knownEntities = {
    names: [...new Set(knownNames)],
    phones: [...new Set(knownPhones)],
    emails: [...new Set(knownEmails)],
  };

  const aiJob = await AIGateway.executeJob({
    clinicId,
    jobType: 'suggested_reply',
    rawPrompt,
    knownEntities,
    conversationId: conversation._id,
    model: opts.model || 'mock-llm-v1',
  });

  return aiJob;
}

// ─── Human Review ─────────────────────────────────────────────────────────────

/**
 * Review an AI Job (e.g. approve, reject, or modify a suggested reply).
 *
 * @param {string} clinicId
 * @param {string} jobId
 * @param {object} reviewData
 * @param {string} reviewerUserId
 */
async function reviewAIJob(clinicId, jobId, reviewData, reviewerUserId) {
  if (!mongoose.isValidObjectId(jobId)) {
    throw AppError.badRequest('Invalid jobId format.', 'VALIDATION_ERROR');
  }

  const job = await AIJob.findOne({ _id: jobId, clinicId });
  if (!job) {
    throw AppError.notFound('AI Job not found.', 'AI_JOB_NOT_FOUND');
  }

  if (!['in_review', 'pending'].includes(job.status)) {
    throw AppError.badRequest(
      `Job cannot be reviewed because it is in '${job.status}' state.`,
      'INVALID_JOB_STATE'
    );
  }

  const { action, notes, modifiedReply } = reviewData;
  if (!['approved', 'rejected', 'modified'].includes(action)) {
    throw AppError.badRequest(
      "Review action must be one of: 'approved', 'rejected', 'modified'.",
      'VALIDATION_ERROR'
    );
  }

  job.reviewedBy = new mongoose.Types.ObjectId(reviewerUserId);
  job.reviewedAt = new Date();
  job.reviewAction = action;
  job.reviewNotes = notes || null;

  if (action === 'approved') {
    job.status = 'approved';
  } else if (action === 'rejected') {
    job.status = 'rejected';
  } else if (action === 'modified') {
    if (!modifiedReply || typeof modifiedReply !== 'string' || !modifiedReply.trim()) {
      throw AppError.badRequest(
        'A modified reply string must be provided when action is modified.',
        'VALIDATION_ERROR'
      );
    }
    job.status = 'approved';
    if (job.rehydratedOutput) {
      job.rehydratedOutput.suggestedReply = modifiedReply.trim();
      job.markModified('rehydratedOutput');
    }
  }

  await job.save();
  return job;
}

// ─── Job Queries ──────────────────────────────────────────────────────────────

/**
 * Get an AI job by ID within the tenant scope.
 */
async function getAIJob(clinicId, jobId) {
  if (!mongoose.isValidObjectId(jobId)) {
    throw AppError.badRequest('Invalid jobId format.', 'VALIDATION_ERROR');
  }

  const job = await AIJob.findOne({ _id: jobId, clinicId });
  if (!job) {
    throw AppError.notFound('AI Job not found.', 'AI_JOB_NOT_FOUND');
  }
  return job;
}

/**
 * List AI jobs for the clinic with filtering and pagination.
 */
async function listAIJobs(clinicId, opts = {}) {
  const { status, jobType, page = 1, limit = 20 } = opts;

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const filter = { clinicId };
  if (status) filter.status = status;
  if (jobType) filter.jobType = jobType;

  const [jobs, total] = await Promise.all([
    AIJob.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean({ virtuals: true }),
    AIJob.countDocuments(filter),
  ]);

  return {
    data: jobs.map((j) => ({
      ...j,
      id: j._id.toString(),
    })),
    pagination: {
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

/**
 * Standalone redaction inspection utility for auditing and testing.
 */
function previewRedaction(text, knownEntities = {}) {
  const redactor = new PIIRedactor();
  return redactor.redact(text, knownEntities);
}

module.exports = {
  scoreLead,
  generateSuggestedReply,
  reviewAIJob,
  getAIJob,
  listAIJobs,
  previewRedaction,
};
