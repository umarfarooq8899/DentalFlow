'use strict';

const mongoose = require('mongoose');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const AppError = require('../errors/AppError');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Verify the conversation belongs to the clinic and return it.
 */
async function requireConversation(clinicId, conversationId) {
  if (!mongoose.isValidObjectId(conversationId)) {
    throw AppError.notFound('Conversation not found.');
  }
  const convo = await Conversation.findOne({ _id: conversationId, clinicId });
  if (!convo) throw AppError.notFound('Conversation not found.');
  return convo;
}

// ─── Create Message ───────────────────────────────────────────────────────────

/**
 * Post a new message to a conversation.
 * @param {string} clinicId
 * @param {string} conversationId
 * @param {object} data
 * @param {string} actorUserId
 */
async function createMessage(clinicId, conversationId, data, actorUserId) {
  const {
    body,
    senderType = 'staff',
    senderName,
    channelMeta = {},
    deliveryStatus = 'pending',
  } = data;

  if (!body || !body.trim()) {
    throw AppError.badRequest('Message body is required.', 'VALIDATION_ERROR');
  }

  const convo = await requireConversation(clinicId, conversationId);

  if (convo.status === 'archived') {
    throw AppError.conflict(
      'Cannot post to an archived conversation.',
      'CONVERSATION_ARCHIVED'
    );
  }

  const now = new Date();

  const message = await Message.create({
    clinicId,
    conversationId: convo._id,
    channel: convo.channel,
    senderType,
    senderId:
      actorUserId && senderType !== 'contact'
        ? new mongoose.Types.ObjectId(actorUserId)
        : null,
    senderName: senderName || null,
    body: body.trim(),
    channelMeta: {
      subject: channelMeta.subject || null,
      externalId: channelMeta.externalId || null,
      inReplyTo: channelMeta.inReplyTo || null,
    },
    deliveryStatus,
    sentAt: deliveryStatus !== 'pending' ? now : null,
  });

  // Update conversation's lastMessageAt
  await Conversation.updateOne(
    { _id: convo._id, clinicId },
    { $set: { lastMessageAt: now } }
  );

  return message;
}

// ─── Get Message ──────────────────────────────────────────────────────────────

async function getMessage(clinicId, conversationId, messageId) {
  await requireConversation(clinicId, conversationId);

  if (!mongoose.isValidObjectId(messageId)) {
    throw AppError.notFound('Message not found.');
  }

  const message = await Message.findOne({
    _id: messageId,
    clinicId,
    conversationId,
    deletedAt: null,
  });

  if (!message) throw AppError.notFound('Message not found.');
  return message;
}

// ─── List Messages (paginated) ────────────────────────────────────────────────

/**
 * Retrieve paginated message history for a conversation.
 * Supports cursor-based (before/after) and offset-based pagination.
 *
 * @param {string} clinicId
 * @param {string} conversationId
 * @param {object} opts
 * @param {number}  [opts.page]      – Offset page (1-based)
 * @param {number}  [opts.limit]     – Results per page (max 100)
 * @param {string}  [opts.before]    – Cursor: return messages before this message ID
 * @param {string}  [opts.after]     – Cursor: return messages after this message ID
 * @param {string}  [opts.sortOrder] – 'asc' | 'desc' (default: 'asc' for chronological)
 */
async function listMessages(clinicId, conversationId, opts = {}) {
  await requireConversation(clinicId, conversationId);

  const {
    page = 1,
    limit = 50,
    before,
    after,
    sortOrder = 'asc',
  } = opts;

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);

  const filter = {
    clinicId,
    conversationId: new mongoose.Types.ObjectId(conversationId),
    deletedAt: null,
  };

  // Cursor-based pagination takes priority over offset
  if (before && mongoose.isValidObjectId(before)) {
    filter._id = { $lt: new mongoose.Types.ObjectId(before) };
  } else if (after && mongoose.isValidObjectId(after)) {
    filter._id = { $gt: new mongoose.Types.ObjectId(after) };
  }

  const sortDir = sortOrder === 'desc' ? -1 : 1;
  const skip = before || after ? 0 : (safePage - 1) * safeLimit;

  const [messages, total] = await Promise.all([
    Message.find(filter)
      .sort({ createdAt: sortDir, _id: sortDir })
      .skip(skip)
      .limit(safeLimit)
      .lean({ virtuals: true }),
    Message.countDocuments({
      clinicId,
      conversationId: new mongoose.Types.ObjectId(conversationId),
      deletedAt: null,
    }),
  ]);

  // Cursors from result edges
  const firstId = messages.length > 0 ? messages[0]._id : null;
  const lastId = messages.length > 0 ? messages[messages.length - 1]._id : null;

  return {
    data: messages.map((m) => ({ ...m, id: m._id.toString() })),
    pagination: {
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
      cursors: {
        before: firstId ? firstId.toString() : null,
        after: lastId ? lastId.toString() : null,
      },
    },
  };
}

// ─── Update Delivery Status ───────────────────────────────────────────────────

/**
 * Update the delivery status of a message (e.g., webhook callback from SMS gateway).
 * @param {string} clinicId
 * @param {string} conversationId
 * @param {string} messageId
 * @param {string} status  – 'sent' | 'delivered' | 'read' | 'failed'
 * @param {object} [meta]
 */
async function updateDeliveryStatus(clinicId, conversationId, messageId, status, meta = {}) {
  const message = await getMessage(clinicId, conversationId, messageId);

  const validStatuses = ['sent', 'delivered', 'read', 'failed'];
  if (!validStatuses.includes(status)) {
    throw AppError.badRequest(`Invalid delivery status: ${status}`, 'VALIDATION_ERROR');
  }

  const now = new Date();
  const update = { deliveryStatus: status };

  if (status === 'sent') update.sentAt = now;
  if (status === 'delivered') update.deliveredAt = now;
  if (status === 'read') update.readAt = now;

  Object.assign(message, update);
  await message.save();
  return message;
}

// ─── Soft-Delete Message ──────────────────────────────────────────────────────

async function deleteMessage(clinicId, conversationId, messageId, actorUserId) {
  const message = await getMessage(clinicId, conversationId, messageId);

  message.deletedAt = new Date();
  message.deletedBy = actorUserId ? new mongoose.Types.ObjectId(actorUserId) : null;
  await message.save();
  return message;
}

module.exports = {
  createMessage,
  getMessage,
  listMessages,
  updateDeliveryStatus,
  deleteMessage,
};
