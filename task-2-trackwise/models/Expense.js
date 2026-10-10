const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true,
    min: [0.01, 'Amount must be greater than zero'],
  },
  currency: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    default: 'INR',
    maxlength: 10,
  },
  category: {
    type: String,
    required: true,
    enum: ['Food', 'Transport', 'Shopping', 'Education', 'Health', 'Bills', 'Other'],
    trim: true,
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  date: {
    type: Date,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

expenseSchema.index({ date: -1 });
expenseSchema.index({ category: 1, date: -1 });

module.exports = mongoose.model('Expense', expenseSchema);
