const mongoose = require('mongoose');

const habitCompletionSchema = new mongoose.Schema({
  habitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Habit',
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  completed: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

habitCompletionSchema.index({ habitId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('HabitCompletion', habitCompletionSchema);
