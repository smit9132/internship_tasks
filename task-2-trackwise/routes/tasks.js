const express = require('express');
const mongoose = require('mongoose');
const Task = require('../models/Task');
const { memoryStore } = require('../services/store');
const { normalizeStatus } = require('../services/tasks/taskService');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { status, priority } = req.query;
    if (mongoose.connection.readyState !== 1) {
      let tasks = [...memoryStore.tasks];
      if (status) tasks = tasks.filter(task => task.status === status);
      if (priority) tasks = tasks.filter(task => task.priority === priority);
      return res.json({ success: true, data: tasks.sort((a, b) => new Date(a.dueDate || '9999-12-31') - new Date(b.dueDate || '9999-12-31')) });
    }
    const query = {};
    if (status) query.status = status;
    if (priority) query.priority = priority;
    const tasks = await Task.find(query).sort({ dueDate: 1, createdAt: -1 }).lean();
    res.json({ success: true, data: tasks });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { title, description, dueDate, priority } = req.body;
    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, message: 'Task title is required.' });
    }
    if (mongoose.connection.readyState !== 1) {
      const task = {
        _id: `${Date.now()}`,
        title: String(title).trim(),
        description: String(description || '').trim(),
        dueDate: dueDate ? new Date(dueDate) : null,
        priority: priority || 'Medium',
        status: 'pending',
        createdAt: new Date(),
      };
      memoryStore.tasks.push(task);
      return res.json({ success: true, data: task });
    }
    const task = await Task.create({
      title: String(title).trim(),
      description: String(description || '').trim(),
      dueDate: dueDate ? new Date(dueDate) : null,
      priority: priority || 'Medium',
    });
    res.json({ success: true, data: task });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      const task = memoryStore.tasks.find(item => String(item._id) === String(req.params.id));
      if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });
      return res.json({ success: true, data: task });
    }
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }
    res.json({ success: true, data: task });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { title, description, dueDate, priority, status } = req.body;
    const update = {};
    if (title !== undefined) update.title = String(title).trim();
    if (description !== undefined) update.description = String(description).trim();
    if (dueDate !== undefined) update.dueDate = dueDate ? new Date(dueDate) : null;
    if (priority) update.priority = priority;
    if (status) update.status = status;

    if (mongoose.connection.readyState !== 1) {
      const index = memoryStore.tasks.findIndex(item => String(item._id) === String(req.params.id));
      if (index === -1) return res.status(404).json({ success: false, message: 'Task not found.' });
      memoryStore.tasks[index] = { ...memoryStore.tasks[index], ...update };
      return res.json({ success: true, data: memoryStore.tasks[index] });
    }

    const task = await Task.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }
    res.json({ success: true, data: task });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status || !['pending', 'completed', 'overdue'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid task status.' });
    }
    if (mongoose.connection.readyState !== 1) {
      const index = memoryStore.tasks.findIndex(item => String(item._id) === String(req.params.id));
      if (index === -1) return res.status(404).json({ success: false, message: 'Task not found.' });
      memoryStore.tasks[index].status = status;
      return res.json({ success: true, data: memoryStore.tasks[index] });
    }
    const task = await Task.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }
    res.json({ success: true, data: task });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      const index = memoryStore.tasks.findIndex(item => String(item._id) === String(req.params.id));
      if (index === -1) return res.status(404).json({ success: false, message: 'Task not found.' });
      memoryStore.tasks.splice(index, 1);
      return res.json({ success: true, message: 'Task deleted.' });
    }
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }
    res.json({ success: true, message: 'Task deleted.' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
