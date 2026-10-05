const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');

const leadSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String },
  source: { type: String, enum: ['website', 'referral', 'advertisement', 'other'] },
  status: {
    type: String,
    enum: ['new', 'contacted', 'qualified', 'converted', 'disqualified'],
    default: 'new'
  },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  conversion: {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
    convertedAt: { type: Date }
  },
  createdAt: { type: Date, default: Date.now }
});

leadSchema.plugin(tenantIsolationPlugin);

module.exports = mongoose.model('Lead', leadSchema);