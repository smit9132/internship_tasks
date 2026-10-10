const mongoose = require('mongoose');

const registrationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed', index: true },
  paymentStatus: { type: String, enum: ['not-required', 'offline-payment-required'], default: 'not-required' },
  registeredAt: { type: Date, default: Date.now },
  cancelledAt: { type: Date, default: null }
}, { timestamps: true });

registrationSchema.index({ user: 1, event: 1 }, { unique: true });
registrationSchema.index({ event: 1, status: 1, registeredAt: -1 });

module.exports = mongoose.model('Registration', registrationSchema);
