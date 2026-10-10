const express = require('express');
const mongoose = require('mongoose');
const Habit = require('../models/Habit');
const HabitCompletion = require('../models/HabitCompletion');
const { memoryStore } = require('../services/store');
const { getHabitSummary, getDailyCompletionStatus } = require('../services/habits/habitService');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({ success: true, data: memoryStore.habits.filter(h => h.active !== false) });
    }
    const habits = await Habit.find({ active: true }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: habits });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, description, frequency } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Habit name is required.' });
    }
    if (mongoose.connection.readyState !== 1) {
      const habit = {
        _id: `${Date.now()}`,
        name: String(name).trim(),
        description: String(description || '').trim(),
        frequency: frequency || 'Daily',
        active: true,
        createdAt: new Date(),
      };
      memoryStore.habits.push(habit);
      return res.status(201).json({ success: true, data: habit });
    }
    const habit = await Habit.create({
      name: String(name).trim(),
      description: String(description || '').trim(),
      frequency: frequency || 'Daily',
    });
    res.status(201).json({ success: true, data: habit });
  } catch (error) {
    next(error);
  }
});

router.get('/status', async (req, res, next) => {
  try {
    const status = await getHabitSummary();
    res.json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
});

router.get('/today', async (req, res, next) => {
  try {
    const data = await getDailyCompletionStatus();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/completions', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      const completions = memoryStore.completions.filter(c => String(c.habitId) === String(req.params.id)).sort((a, b) => new Date(b.date) - new Date(a.date));
      return res.json({ success: true, data: completions });
    }
    const completions = await HabitCompletion.find({ habitId: req.params.id }).sort({ date: -1 }).lean();
    res.json({ success: true, data: completions });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/complete', async (req, res, next) => {
  try {
    const { date } = req.body;
    const targetDate = date ? new Date(date) : new Date();
    if (Number.isNaN(targetDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date.' });
    }

    if (mongoose.connection.readyState !== 1) {
      const habit = memoryStore.habits.find(h => String(h._id) === String(req.params.id));
      if (!habit) {
        return res.status(404).json({ success: false, message: 'Habit not found.' });
      }
      const start = new Date(targetDate); start.setHours(0,0,0,0);
      const end = new Date(targetDate); end.setHours(23,59,59,999);
      const exists = memoryStore.completions.some(c => String(c.habitId) === String(req.params.id) && new Date(c.date) >= start && new Date(c.date) <= end);
      if (exists) {
        return res.status(409).json({ success: false, message: 'Habit already completed for that date.' });
      }
      const completion = { _id: `${Date.now()}`, habitId: req.params.id, date: targetDate, completed: true, createdAt: new Date() };
      memoryStore.completions.push(completion);
      return res.status(201).json({ success: true, data: completion });
    }

    const habit = await Habit.findById(req.params.id);
    if (!habit) {
      return res.status(404).json({ success: false, message: 'Habit not found.' });
    }

    const start = new Date(targetDate); start.setHours(0,0,0,0);
    const end = new Date(targetDate); end.setHours(23,59,59,999);
    const existing = await HabitCompletion.findOne({ habitId: req.params.id, date: { $gte: start, $lte: end } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Habit already completed for that date.' });
    }

    const completion = await HabitCompletion.create({ habitId: req.params.id, date: targetDate, completed: true });
    res.status(201).json({ success: true, data: completion });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id/complete', async (req, res, next) => {
  try {
    const { date } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    if (Number.isNaN(targetDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date.' });
    }
    if (mongoose.connection.readyState !== 1) {
      const start = new Date(targetDate); start.setHours(0,0,0,0);
      const end = new Date(targetDate); end.setHours(23,59,59,999);
      const index = memoryStore.completions.findIndex(c => String(c.habitId) === String(req.params.id) && new Date(c.date) >= start && new Date(c.date) <= end);
      if (index === -1) {
        return res.status(404).json({ success: false, message: 'Completion not found.' });
      }
      memoryStore.completions.splice(index, 1);
      return res.json({ success: true, message: 'Completion removed.' });
    }
    const start = new Date(targetDate); start.setHours(0,0,0,0);
    const end = new Date(targetDate); end.setHours(23,59,59,999);
    const deleted = await HabitCompletion.findOneAndDelete({ habitId: req.params.id, date: { $gte: start, $lte: end } });
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Completion not found.' });
    }
    res.json({ success: true, message: 'Completion removed.' });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { name, description, frequency, active } = req.body;
    if (mongoose.connection.readyState !== 1) {
      const index = memoryStore.habits.findIndex(h => String(h._id) === String(req.params.id));
      if (index === -1) return res.status(404).json({ success: false, message: 'Habit not found.' });
      memoryStore.habits[index] = { ...memoryStore.habits[index], ...(name && { name: String(name).trim() }), ...(description !== undefined && { description: String(description).trim() }), ...(frequency && { frequency }), ...(active !== undefined && { active: Boolean(active) }) };
      return res.json({ success: true, data: memoryStore.habits[index] });
    }
    const habit = await Habit.findByIdAndUpdate(req.params.id, {
      ...(name && { name: String(name).trim() }),
      ...(description !== undefined && { description: String(description).trim() }),
      ...(frequency && { frequency }),
      ...(active !== undefined && { active: Boolean(active) }),
    }, { new: true, runValidators: true });
    if (!habit) {
      return res.status(404).json({ success: false, message: 'Habit not found.' });
    }
    res.json({ success: true, data: habit });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      const habitIndex = memoryStore.habits.findIndex(h => String(h._id) === String(req.params.id));
      if (habitIndex === -1) return res.status(404).json({ success: false, message: 'Habit not found.' });
      memoryStore.habits.splice(habitIndex, 1);
      memoryStore.completions = memoryStore.completions.filter(c => String(c.habitId) !== String(req.params.id));
      return res.json({ success: true, message: 'Habit deleted.' });
    }
    const habit = await Habit.findByIdAndDelete(req.params.id);
    if (!habit) {
      return res.status(404).json({ success: false, message: 'Habit not found.' });
    }
    await HabitCompletion.deleteMany({ habitId: req.params.id });
    res.json({ success: true, message: 'Habit deleted.' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
