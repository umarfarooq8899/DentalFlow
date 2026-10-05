'use strict';

const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Lead = require('../models/Lead');
const Patient = require('../models/Patient');
const AppError = require('../errors/AppError');

// ─── Create Conversation ──────────────────────────────────────────────────────

/**
 * Create a new conversation.
 * @param {string} clinicId
 * @param {object} data
 * @param {string} actorUserId
 */
async function createConversation(clinicId, data, actorUserId) {
  const {
    channel,
    subject,
    leadId,
    patientId,
    participants = [],
    channelMeta = {},
  } = data;

  // Validate linked resources belong to the clinic
  if (leadId) {
    if (!mongoose.isValidObjectId(leadId)) {
      throw AppError.badRequest('Invalid leadId.', 'VALIDATION_ERROR');
    }
    const lead = await Lead.findOne({ _id: leadId, clinicId });
    if (!lead) throw AppError.notFound('Lead not found.');
  }

  if (patientId) {
    if (!mongoose.isValidObjectId(patientId)) {
      throw AppError.badRequest('Invalid patientId.', 'VALIDATION_ERROR');
    }
    const patient = await Patient.findOne({ _id: patientId, clinicId });
    if (!patient) throw AppError.notFound('Patient not found.');
  }

  // Build participant list — always include the creating staff member
  const participantList = [];

  // Add the actor as staff participant if not already listed
  const actorAlreadyIncluded = participants.some(
    (p) => p.userId && p.userId.toString() === actorUserId
  );
  if (actorUserId && !actorAlreadyIncluded) {
    participantList.push({
      userId: new mongoose.Types.ObjectId(actorUserId),
      role: 'staff',
      joinedAt: new Date(),
    });
  }

  for (const p of participants) {
    if (p.userId && !mongoose.isValidObjectId(p.userId)) {
      throw AppError.badRequest(`Invalid participant userId: ${p.userId}`, 'VALIDATION_ERROR');
    }
    participantList.push({
      userId: p.userId ? new mongoose.Types.ObjectId(p.userId) : null,
      role: p.role || 'contact',
      displayName: p.displayName || null,
      joinedAt: new Date(),
    });
  }

  const conversation = await Conversation.create({
    clinicId,
    channel,
    subject: subject || null,
    leadId: leadId ? new mongoose.Types.ObjectId(leadId) : null,
    patientId: patientId ? new mongoose.Types.ObjectId(patientId) : null,
    participants: participantList,
    channelMeta: {
      externalId: channelMeta.externalId || null,
      from: channelMeta.from || null,
      to: channelMeta.to || null,
    },
    status: 'open',
    createdBy: actorUserId ? new mongoose.Types.ObjectId(actorUserId) : null,
  });

  return conversation;
}

// ─── Get Conversation ─────────────────────────────────────────────────────────

async function getConversation(clinicId, conversationId) {
  if (!mongoose.isValidObjectId(conversationId)) {
    throw AppError.notFound('Conversation not found.');
  }
  const convo = await Conversation.findOne({ _id: conversationId, clinicId });
  if (!convo) throw AppError.notFound('Conversation not found.');
  return convo;
}

// ─── List Conversations ───────────────────────────────────────────────────────

/**
 * List conversations with filtering and pagination.
 * @param {string} clinicId
 * @param {object} opts
 */
async function listConversations(clinicId, opts = {}) {
  const {
    status,
    channel,
    leadId,
    patientId,
    page = 1,
    limit = 20,
    sortBy = 'lastMessageAt',
    sortOrder = 'desc',
  } = opts;

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const allowedSortFields = ['createdAt', 'lastMessageAt', 'status'];
  const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'lastMessageAt';
  const sortDir = sortOrder === 'asc' ? 1 : -1;

  const filter = { clinicId };
  if (status) filter.status = status;
  if (channel) filter.channel = channel;

  if (leadId) {
    if (!mongoose.isValidObjectId(leadId)) {
      throw AppError.badRequest('Invalid leadId.', 'VALIDATION_ERROR');
    }
    filter.leadId = new mongoose.Types.ObjectId(leadId);
  }

  if (patientId) {
    if (!mongoose.isValidObjectId(patientId)) {
      throw AppError.badRequest('Invalid patientId.', 'VALIDATION_ERROR');
    }
    filter.patientId = new mongoose.Types.ObjectId(patientId);
  }

  const [conversations, total] = await Promise.all([
    Conversation.find(filter)
      .sort({ [sortField]: sortDir })
      .skip(skip)
      .limit(safeLimit)
      .lean({ virtuals: true }),
    Conversation.countDocuments(filter),
  ]);

  return {
    data: conversations,
    pagination: {
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

// ─── Update Conversation Status ───────────────────────────────────────────────

/**
 * Close or re-open a conversation.
 */
async function updateConversationStatus(clinicId, conversationId, newStatus) {
  const convo = await getConversation(clinicId, conversationId);
  const validStatuses = ['open', 'closed', 'archived'];
  if (!validStatuses.includes(newStatus)) {
    throw AppError.badRequest(`Invalid status: ${newStatus}`, 'VALIDATION_ERROR');
  }
  convo.status = newStatus;
  await convo.save();
  return convo;
}

// ─── Add Participant ──────────────────────────────────────────────────────────

async function addParticipant(clinicId, conversationId, participantData) {
  const convo = await getConversation(clinicId, conversationId);

  const { userId, role = 'staff', displayName } = participantData;

  if (userId && !mongoose.isValidObjectId(userId)) {
    throw AppError.badRequest('Invalid participant userId.', 'VALIDATION_ERROR');
  }

  // Prevent duplicating active participants
  const alreadyActive = convo.participants.some(
    (p) => p.userId && p.userId.toString() === userId && !p.leftAt
  );
  if (userId && alreadyActive) {
    throw AppError.conflict('Participant is already in this conversation.', 'PARTICIPANT_EXISTS');
  }

  convo.participants.push({
    userId: userId ? new mongoose.Types.ObjectId(userId) : null,
    role,
    displayName: displayName || null,
    joinedAt: new Date(),
  });

  await convo.save();
  return convo;
}

// ─── Remove Participant ───────────────────────────────────────────────────────

async function removeParticipant(clinicId, conversationId, participantId) {
  const convo = await getConversation(clinicId, conversationId);

  const participant = convo.participants.id(participantId);
  if (!participant) throw AppError.notFound('Participant not found.');
  if (participant.leftAt) {
    throw AppError.conflict('Participant has already left.', 'PARTICIPANT_ALREADY_LEFT');
  }

  participant.leftAt = new Date();
  await convo.save();
  return convo;
}

module.exports = {
  createConversation,
  getConversation,
  listConversations,
  updateConversationStatus,
  addParticipant,
  removeParticipant,
};
