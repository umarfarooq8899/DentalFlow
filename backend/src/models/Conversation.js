'use strict';

const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');

/**
 * Participant in a conversation — either a staff user or the lead/patient contact.
 */
const participantSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    role: {
      type: String,
      enum: ['staff', 'contact'],
      required: true,
    },
    displayName: { type: String, trim: true, maxlength: 200, default: null },
    joinedAt: { type: Date, required: true, default: Date.now },
    leftAt: { type: Date, default: null },
  },
  {
    _id: true,
    timestamps: false,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
      },
    },
  }
);

const conversationSchema = new mongoose.Schema(
  {
    // ── Subject (optional) ────────────────────────────────────────────────
    subject: { type: String, trim: true, maxlength: 300, default: null },

    // ── Channel ───────────────────────────────────────────────────────────
    channel: {
      type: String,
      enum: ['sms', 'email', 'whatsapp', 'in_app', 'phone_note'],
      required: true,
    },

    // ── Channel Metadata ──────────────────────────────────────────────────
    // External identifiers for threading (e.g. email thread-id, WhatsApp chat-id)
    channelMeta: {
      externalId: { type: String, trim: true, default: null },
      from: { type: String, trim: true, maxlength: 320, default: null },
      to: { type: String, trim: true, maxlength: 320, default: null },
    },

    // ── Relations ─────────────────────────────────────────────────────────
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      default: null,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      default: null,
    },

    // ── Participants ──────────────────────────────────────────────────────
    participants: { type: [participantSchema], default: [] },

    // ── State ─────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['open', 'closed', 'archived'],
      required: true,
      default: 'open',
    },
    lastMessageAt: { type: Date, default: null },

    // ── Ownership ─────────────────────────────────────────────────────────
    createdBy: {
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

conversationSchema.plugin(tenantIsolationPlugin);

// ── Indexes ───────────────────────────────────────────────────────────────────
conversationSchema.index({ clinicId: 1, status: 1, lastMessageAt: -1 });
conversationSchema.index({ clinicId: 1, leadId: 1 });
conversationSchema.index({ clinicId: 1, patientId: 1 });
conversationSchema.index({ clinicId: 1, channel: 1, status: 1 });
conversationSchema.index({ clinicId: 1, createdAt: -1 });
conversationSchema.index({ clinicId: 1, 'channelMeta.externalId': 1 });

module.exports = mongoose.model('Conversation', conversationSchema);
