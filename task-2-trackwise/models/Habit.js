const mongoose = require('mongoose');

const habitSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  description: {
    type: String,
    trim: true,
    default: '',
    maxlength: 300,
  },
  frequency: {
    type: String,
    required: true,
    enum: ['Daily', 'Weekly', 'Custom'],
    default: 'Daily',
  },
  active: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

module.exports = mongoose.model('Habit', habitSchema);
