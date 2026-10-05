const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');

const conversationSchema = new mongoose.Schema({
  participants: [
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      role: { type: String, enum: ['patient', 'dentist', 'admin'] }
    }
  ],
  channel: {
    type: String,
    enum: ['email', 'sms', 'chat', 'phone'],
    required: true
  },
  createdAt: { type: Date, default: Date.now },
  lastActivity: { type: Date, default: Date.now }
});

conversationSchema.plugin(tenantIsolationPlugin);

module.exports = mongoose.model('Conversation', conversationSchema);