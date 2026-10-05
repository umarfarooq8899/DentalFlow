'use strict';

const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');

/**
 * Per-recipient delivery state (for broadcast or multi-recipient channels).
 */
const deliveryStateSchema = new mongoose.Schema(
  {
    recipientId: { type: String, trim: true, required: true },
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
      default: 'pending',
    },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    failureReason: { type: String, trim: true, default: null },
  },
  { _id: false, timestamps: false }
);

const messageSchema = new mongoose.Schema(
  {
    // ── Core ──────────────────────────────────────────────────────────────
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
    },

    // ── Channel (denormalized for efficient querying without populating) ──
    channel: {
      type: String,
      enum: ['sms', 'email', 'whatsapp', 'in_app', 'phone_note'],
      required: true,
    },

    // ── Sender ────────────────────────────────────────────────────────────
    senderType: {
      type: String,
      enum: ['staff', 'contact', 'system'],
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    senderName: { type: String, trim: true, maxlength: 200, default: null },

    // ── Content ───────────────────────────────────────────────────────────
    body: { type: String, required: true, trim: true, maxlength: 10000 },

    // ── Channel-specific metadata ─────────────────────────────────────────
    channelMeta: {
      // Email-specific
      subject: { type: String, trim: true, maxlength: 300, default: null },
      // External message ID (e.g. email Message-ID header, SMS sid)
      externalId: { type: String, trim: true, maxlength: 500, default: null },
      // Thread references for email
      inReplyTo: { type: String, trim: true, maxlength: 500, default: null },
    },

    // ── Delivery ──────────────────────────────────────────────────────────
    // Aggregate delivery status (for single-recipient messages)
    deliveryStatus: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
      default: 'pending',
    },
    // Per-recipient delivery state (for multi-recipient channels)
    deliveryStates: { type: [deliveryStateSchema], default: [] },

    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },

    // ── Soft delete (message retraction) ──────────────────────────────────
    deletedAt: { type: Date, default: null },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
      },
    },
  }
);

messageSchema.plugin(tenantIsolationPlugin);

// ── Indexes ───────────────────────────────────────────────────────────────────
// Primary query: messages within a conversation, newest first (pagination)
messageSchema.index({ clinicId: 1, conversationId: 1, createdAt: -1 });
// Filter by sender
messageSchema.index({ clinicId: 1, conversationId: 1, senderType: 1 });
// Channel-level queries
messageSchema.index({ clinicId: 1, channel: 1, createdAt: -1 });
// External ID dedup lookups
messageSchema.index({ clinicId: 1, 'channelMeta.externalId': 1 });

module.exports = mongoose.model('Message', messageSchema);
