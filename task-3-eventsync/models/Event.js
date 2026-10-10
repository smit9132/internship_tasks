const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, minlength: 4, maxlength: 120 },
  description: { type: String, required: true, trim: true, minlength: 20, maxlength: 10000 },
  category: {
    type: String, required: true,
    enum: ['Technology', 'Business', 'Arts', 'Music', 'Food', 'Wellness', 'Education', 'Community', 'Other']
  },
  coverImage: { type: String, trim: true, maxlength: 2048, default: '' },
  venue: {
    type: { type: String, enum: ['in-person', 'online'], required: true },
    name: { type: String, trim: true, maxlength: 120, default: '' },
    address: { type: String, trim: true, maxlength: 300, default: '' },
    meetingUrl: { type: String, trim: true, maxlength: 2048, default: '' }
  },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  timezone: { type: String, required: true, trim: true, maxlength: 80, default: 'UTC' },
  registrationOpensAt: { type: Date, required: true },
  registrationClosesAt: { type: Date, required: true },
  capacity: { type: Number, required: true, min: 1, max: 100000 },
  registeredCount: { type: Number, default: 0, min: 0 },
  ticketPrice: { type: Number, default: 0, min: 0, max: 1000000 },
  currency: { type: String, uppercase: true, trim: true, default: 'USD', match: /^[A-Z]{3}$/ },
  organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  organizerName: { type: String, required: true, trim: true, maxlength: 80 },
  status: { type: String, enum: ['draft', 'published', 'cancelled', 'completed'], default: 'draft', index: true }
}, { timestamps: true });

eventSchema.index({ status: 1, startAt: 1, category: 1 });
eventSchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('Event', eventSchema);
