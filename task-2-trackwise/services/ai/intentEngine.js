const mongoose = require('mongoose');
const Expense = require('../../models/Expense');
const Habit = require('../../models/Habit');
const HabitCompletion = require('../../models/HabitCompletion');
const Task = require('../../models/Task');
const { memoryStore } = require('../store');

function extractAmount(text) {
  const match = text.match(/(?:rs\.?\s*|rupees?\s*|inr\.?\s*|₹\s*)?(\d+(?:\.\d{1,2})?)/i);
  if (!match) return null;
  return Number(match[1]);
}

function getDateFromText(text) {
  const now = new Date();
  const lower = text.toLowerCase();
  if (lower.includes('today')) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (lower.includes('yesterday')) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }
  if (lower.includes('tomorrow')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d;
  }
  return new Date();
}

function getCategoryFromText(text) {
  const lower = text.toLowerCase();
  if (lower.includes('food') || lower.includes('lunch') || lower.includes('dinner') || lower.includes('breakfast') || lower.includes('coffee') || lower.includes('snack') || lower.includes('cafe')) return 'Food';
  if (lower.includes('travel') || lower.includes('transport') || lower.includes('fuel') || lower.includes('bus') || lower.includes('train') || lower.includes('taxi')) return 'Transport';
  if (lower.includes('shopping') || lower.includes('shop') || lower.includes('clothes') || lower.includes('purchase')) return 'Shopping';
  if (lower.includes('education') || lower.includes('study') || lower.includes('course') || lower.includes('books')) return 'Education';
  if (lower.includes('health') || lower.includes('medicine') || lower.includes('doctor') || lower.includes('pharmacy')) return 'Health';
  if (lower.includes('bill') || lower.includes('rent') || lower.includes('utility') || lower.includes('electricity') || lower.includes('internet')) return 'Bills';
  return 'Other';
}

function cleanExpenseDescription(text) {
  const withoutAmount = text
    .replace(/(?:rs\.?|rupees?|inr|₹|usd|dollars?)\b/gi, ' ')
    .replace(/\d+(?:\.\d{1,2})?/g, ' ')
    .replace(/\b(?:i|me|my|spent|paid|bought|purchase|for|on|at|today|yesterday|tomorrow|this|that|the|a|an)\b/gi, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return withoutAmount || 'Expense';
}

function parseExpenseCommand(text) {
  const amount = extractAmount(text);
  if (!amount || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return {
    type: 'expense',
    payload: {
      amount,
      category: getCategoryFromText(text),
      description: cleanExpenseDescription(text),
      date: getDateFromText(text),
      currency: 'INR',
    },
  };
}

async function parseTaskCommand(text) {
  const normalized = text.trim();
  const match = normalized.match(/(?:please\s+)?(?:add|create|new|schedule|plan|set)\s+(?:a\s+)?(?:task|todo)\s+(?:to\s+|for\s+|about\s+)?(.+?)(?=\s+(?:due|tomorrow|today|next|on)|$)/i);
  const title = match ? match[1].trim() : null;
  if (!title) return null;

  const dueDate = /tomorrow/i.test(text) ? new Date(Date.now() + 86400000) : /today/i.test(text) ? new Date() : null;
  const priority = /high/i.test(text) ? 'High' : /low/i.test(text) ? 'Low' : 'Medium';
  return {
    type: 'task',
    payload: { title, description: '', dueDate, priority },
  };
}

async function parseHabitCommand(text) {
  const lower = text.toLowerCase();
  if (!/\b(?:completed|did|done|finished|marked|logged)\b/i.test(lower) || !/\bhabit\b/i.test(lower)) {
    return null;
  }

  const match = text.match(/(?:completed|did|done|finished|marked|logged)\s+(?:my\s+)?(.+?)(?:\s+habit\b|$)/i);
  const name = match ? match[1].trim() : 'Habit';

  if (mongoose.connection.readyState !== 1) {
    let existing = memoryStore.habits.find(h => h.name.toLowerCase().includes(name.toLowerCase()));
    if (!existing) {
      existing = { _id: `${Date.now()}`, name, description: 'Tracked via AI assistant', frequency: 'Daily', active: true };
      memoryStore.habits.push(existing);
    }
    return { type: 'habit_complete', payload: { habitId: existing._id, date: new Date() } };
  }

  const existing = await Habit.findOne({ name: { $regex: new RegExp(name, 'i') } });
  if (!existing) {
    const created = await Habit.create({ name, description: 'Tracked via AI assistant', frequency: 'Daily' });
    return { type: 'habit_complete', payload: { habitId: created._id, date: new Date() } };
  }
  return { type: 'habit_complete', payload: { habitId: existing._id, date: new Date() } };
}

async function executeIntentIntent(text) {
  const normalized = text.trim();
  if (!normalized) {
    return { type: 'unsupported', message: 'Please enter a command or question.' };
  }

  if (/how much did i spend this week|what did i spend this week|spend this week/i.test(normalized)) {
    if (mongoose.connection.readyState !== 1) {
      const start = new Date(); start.setDate(start.getDate() - 6);
      const total = memoryStore.expenses.filter(e => new Date(e.date) >= start).reduce((sum, e) => sum + Number(e.amount || 0), 0);
      return { type: 'expense_summary', message: `You spent ${total} INR this week.` };
    }
    const start = new Date(); start.setDate(start.getDate() - 6);
    const total = await Expense.aggregate([{ $match: { date: { $gte: start } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    return { type: 'expense_summary', message: `You spent ${total[0]?.total || 0} INR this week.` };
  }

  if (/show my five most recent expenses|recent expenses|show recent expenses/i.test(normalized)) {
    if (mongoose.connection.readyState !== 1) {
      const expenses = [...memoryStore.expenses].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
      return { type: 'expenses_list', message: expenses.length ? expenses.map(e => `${e.description}: ${e.amount} ${e.currency}`).join('; ') : 'No expenses found.' };
    }
    const expenses = await Expense.find().sort({ date: -1 }).limit(5).lean();
    return { type: 'expenses_list', message: expenses.length ? expenses.map(e => `${e.description}: ${e.amount} ${e.currency}`).join('; ') : 'No expenses found.' };
  }

  if (/pending tasks|show my pending tasks/i.test(normalized)) {
    if (mongoose.connection.readyState !== 1) {
      const tasks = memoryStore.tasks.filter(t => t.status !== 'completed');
      return { type: 'tasks_list', message: tasks.length ? tasks.map(t => `${t.title} (${t.priority})`).join('; ') : 'No pending tasks.' };
    }
    const tasks = await Task.find({ status: 'pending' }).sort({ dueDate: 1 }).lean();
    return { type: 'tasks_list', message: tasks.length ? tasks.map(t => `${t.title} (${t.priority})`).join('; ') : 'No pending tasks.' };
  }

  if (/show my.* habits|what habits do i need to complete today/i.test(normalized)) {
    if (mongoose.connection.readyState !== 1) {
      const habits = memoryStore.habits.filter(h => h.active !== false);
      const today = new Date();
      const completedSet = new Set(memoryStore.completions.filter(c => {
        const d = new Date(c.date);
        return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
      }).map(c => String(c.habitId)));
      const pending = habits.filter(h => !completedSet.has(String(h._id))).map(h => h.name);
      return { type: 'habit_summary', message: pending.length ? `Complete today: ${pending.join(', ')}` : 'All habits are complete for today.' };
    }
    const habits = await Habit.find({ active: true }).lean();
    const today = new Date();
    const completed = await HabitCompletion.find({ date: { $gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()), $lt: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1) } }).lean();
    const completedSet = new Set(completed.map(c => String(c.habitId)));
    const pending = habits.filter(h => !completedSet.has(String(h._id))).map(h => h.name);
    return { type: 'habit_summary', message: pending.length ? `Complete today: ${pending.join(', ')}` : 'All habits are complete for today.' };
  }

  const expenseCommand = parseExpenseCommand(normalized);
  if (expenseCommand) {
    if (mongoose.connection.readyState !== 1) {
      const entry = { ...expenseCommand.payload, _id: `${Date.now()}`, createdAt: new Date(), date: expenseCommand.payload.date || new Date() };
      memoryStore.expenses.push(entry);
      return { type: 'expense_created', message: `Added expense: ${entry.description} for ${entry.amount} ${entry.currency}.` };
    }
    const created = await Expense.create(expenseCommand.payload);
    return { type: 'expense_created', message: `Added expense: ${created.description} for ${created.amount} ${created.currency}.` };
  }

  const taskCommand = await parseTaskCommand(normalized);
  if (taskCommand) {
    if (mongoose.connection.readyState !== 1) {
      const entry = { ...taskCommand.payload, _id: `${Date.now()}`, status: 'pending', createdAt: new Date() };
      memoryStore.tasks.push(entry);
      return { type: 'task_created', message: `Added task: ${entry.title}.` };
    }
    const created = await Task.create(taskCommand.payload);
    return { type: 'task_created', message: `Added task: ${created.title}.` };
  }

  const habitCommand = await parseHabitCommand(normalized);
  if (habitCommand) {
    if (mongoose.connection.readyState !== 1) {
      const today = new Date();
      const key = String(habitCommand.payload.habitId);
      const exists = memoryStore.completions.some(c => String(c.habitId) === key && new Date(c.date).toDateString() === today.toDateString());
      if (exists) {
        return { type: 'habit_duplicate', message: 'This habit is already marked complete for today.' };
      }
      const completion = { ...habitCommand.payload, _id: `${Date.now()}`, completed: true, createdAt: new Date() };
      memoryStore.completions.push(completion);
      return { type: 'habit_created', message: `Marked habit completion for ${habitCommand.payload.habitId}.` };
    }
    const exists = await HabitCompletion.findOne({ habitId: habitCommand.payload.habitId, date: { $gte: new Date(new Date().setHours(0,0,0,0)), $lt: new Date(new Date().setHours(23,59,59,999)) } });
    if (exists) {
      return { type: 'habit_duplicate', message: 'This habit is already marked complete for today.' };
    }
    const created = await HabitCompletion.create({ ...habitCommand.payload, completed: true });
    return { type: 'habit_created', message: `Marked habit completion for ${created.habitId}.` };
  }

  return { type: 'unsupported', message: 'I can help with expenses, habits, and tasks. Try a supported command.' };
}

module.exports = { executeIntentIntent, parseExpenseCommand, parseTaskCommand, parseHabitCommand };
