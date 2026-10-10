const mongoose = require('mongoose');
const Task = require('../../models/Task');
const { memoryStore } = require('../store');

function normalizeStatus(task) {
  if (task.status === 'completed') return 'completed';
  if (task.dueDate && new Date(task.dueDate) < new Date().setHours(0, 0, 0, 0)) return 'overdue';
  return 'pending';
}

async function getTaskOverview() {
  if (mongoose.connection.readyState !== 1) {
    const tasks = [...memoryStore.tasks].sort((a, b) => new Date(a.dueDate || '9999-12-31') - new Date(b.dueDate || '9999-12-31'));
    const pending = tasks.filter(task => normalizeStatus(task) === 'pending');
    const completed = tasks.filter(task => normalizeStatus(task) === 'completed');
    const overdue = tasks.filter(task => normalizeStatus(task) === 'overdue');
    return {
      total: tasks.length,
      pending: pending.length,
      completed: completed.length,
      overdue: overdue.length,
      upcoming: tasks.filter(task => task.dueDate && normalizeStatus(task) !== 'completed').slice(0, 5),
    };
  }

  const tasks = await Task.find().sort({ dueDate: 1, createdAt: -1 }).lean();
  const pending = tasks.filter(task => normalizeStatus(task) === 'pending');
  const completed = tasks.filter(task => normalizeStatus(task) === 'completed');
  const overdue = tasks.filter(task => normalizeStatus(task) === 'overdue');

  return {
    total: tasks.length,
    pending: pending.length,
    completed: completed.length,
    overdue: overdue.length,
    upcoming: tasks.filter(task => task.dueDate && normalizeStatus(task) !== 'completed').slice(0, 5),
  };
}

module.exports = { getTaskOverview, normalizeStatus };
