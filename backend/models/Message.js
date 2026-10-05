const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');

const messageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  content: { type: String, required: true },
  sender: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: { type: String, enum: ['patient', 'dentist', 'admin'] }
  },
  delivered: { type: Boolean, default: false },
  read: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});

messageSchema.plugin(tenantIsolationPlugin);

module.exports = mongoose.model('Message', messageSchema);