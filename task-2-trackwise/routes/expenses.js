const express = require('express');
const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const { memoryStore } = require('../services/store');
const { getExpenseStats, getExpenseSearch } = require('../services/expenses/expenseService');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { category, description, startDate, endDate } = req.query;
    const expenses = await getExpenseSearch({ category, description, startDate, endDate });
    res.json({ success: true, data: expenses });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { amount, category, description, date, currency } = req.body;
    if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be a positive number.' });
    }
    if (!category || !['Food', 'Transport', 'Shopping', 'Education', 'Health', 'Bills', 'Other'].includes(category)) {
      return res.status(400).json({ success: false, message: 'Invalid expense category.' });
    }
    if (!description || !String(description).trim()) {
      return res.status(400).json({ success: false, message: 'Description is required.' });
    }
    const parsedDate = new Date(date || Date.now());
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date.' });
    }

    if (mongoose.connection.readyState !== 1) {
      const expense = {
        _id: `${Date.now()}`,
        amount: Number(amount),
        category,
        description: String(description).trim(),
        date: parsedDate,
        currency: (currency || 'INR').toUpperCase(),
        createdAt: new Date(),
      };
      memoryStore.expenses.push(expense);
      return res.status(201).json({ success: true, data: expense });
    }

    const expense = await Expense.create({
      amount: Number(amount),
      category,
      description: String(description).trim(),
      date: parsedDate,
      currency: (currency || 'INR').toUpperCase(),
    });

    res.status(201).json({ success: true, data: expense });
  } catch (error) {
    next(error);
  }
});

router.get('/stats', async (req, res, next) => {
  try {
    const stats = await getExpenseStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      const expense = memoryStore.expenses.find(item => String(item._id) === String(req.params.id));
      if (!expense) return res.status(404).json({ success: false, message: 'Expense not found.' });
      return res.json({ success: true, data: expense });
    }
    const expense = await Expense.findById(req.params.id);
    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found.' });
    }
    res.json({ success: true, data: expense });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { amount, category, description, date, currency } = req.body;
    const update = {};

    if (amount !== undefined) {
      if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
        return res.status(400).json({ success: false, message: 'Amount must be a positive number.' });
      }
      update.amount = Number(amount);
    }
    if (category) {
      if (!['Food', 'Transport', 'Shopping', 'Education', 'Health', 'Bills', 'Other'].includes(category)) {
        return res.status(400).json({ success: false, message: 'Invalid expense category.' });
      }
      update.category = category;
    }
    if (description !== undefined) {
      if (!String(description).trim()) {
        return res.status(400).json({ success: false, message: 'Description is required.' });
      }
      update.description = String(description).trim();
    }
    if (date) {
      const parsedDate = new Date(date);
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid date.' });
      }
      update.date = parsedDate;
    }
    if (currency) {
      update.currency = String(currency).toUpperCase();
    }

    if (mongoose.connection.readyState !== 1) {
      const index = memoryStore.expenses.findIndex(item => String(item._id) === String(req.params.id));
      if (index === -1) return res.status(404).json({ success: false, message: 'Expense not found.' });
      memoryStore.expenses[index] = { ...memoryStore.expenses[index], ...update };
      return res.json({ success: true, data: memoryStore.expenses[index] });
    }

    const expense = await Expense.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found.' });
    }
    res.json({ success: true, data: expense });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      const index = memoryStore.expenses.findIndex(item => String(item._id) === String(req.params.id));
      if (index === -1) return res.status(404).json({ success: false, message: 'Expense not found.' });
      memoryStore.expenses.splice(index, 1);
      return res.json({ success: true, message: 'Expense deleted.' });
    }
    const deleted = await Expense.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Expense not found.' });
    }
    res.json({ success: true, message: 'Expense deleted.' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
