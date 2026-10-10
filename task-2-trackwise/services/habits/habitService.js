const mongoose = require('mongoose');
const Habit = require('../../models/Habit');
const HabitCompletion = require('../../models/HabitCompletion');
const { memoryStore } = require('../store');

function getLocalDateString(dateValue) {
  const date = new Date(dateValue);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function getStartOfDay(dateValue) {
  const d = new Date(dateValue);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function getHabitSummary() {
  if (mongoose.connection.readyState !== 1) {
    const habits = memoryStore.habits.filter(h => h.active !== false);
    const today = getStartOfDay(new Date());
    const todayEnd = new Date(today.getTime() + 86400000);
    const completions = memoryStore.completions.filter(c => {
      const date = new Date(c.date);
      return date >= today && date < todayEnd;
    });
    const completionMap = new Map(completions.map(c => [String(c.habitId), c]));
    const completedToday = habits.filter(h => completionMap.has(String(h._id))).length;
    const rate = habits.length ? (completedToday / habits.length) * 100 : 0;
    return { activeHabits: habits, completedToday, completionRate: Number(rate.toFixed(1)) };
  }

  const habits = await Habit.find({ active: true }).lean();
  const today = getStartOfDay(new Date());
  const completions = await HabitCompletion.find({ date: { $gte: today, $lt: new Date(today.getTime() + 86400000) } }).lean();
  const completionMap = new Map(completions.map(c => [String(c.habitId), c]));

  const completedToday = habits.filter(h => completionMap.has(String(h._id))).length;
  const rate = habits.length ? (completedToday / habits.length) * 100 : 0;

  return {
    activeHabits: habits,
    completedToday,
    completionRate: Number(rate.toFixed(1)),
  };
}

async function getHabitStreak(habitId) {
  if (mongoose.connection.readyState !== 1) {
    const completions = memoryStore.completions.filter(c => String(c.habitId) === String(habitId) && c.completed !== false).sort((a, b) => new Date(b.date) - new Date(a.date));
    if (!completions.length) return 0;
    const uniqueDates = [...new Set(completions.map(c => getLocalDateString(c.date)))].sort((a, b) => new Date(b) - new Date(a));
    let streak = 0;
    let cursor = new Date();
    while (true) {
      const target = getLocalDateString(cursor);
      if (uniqueDates.includes(target)) {
        streak += 1;
        cursor = new Date(cursor.getTime() - 86400000);
        continue;
      }
      if (streak > 0) break;
      cursor = new Date(cursor.getTime() - 86400000);
      if (new Date(target) < new Date(uniqueDates[uniqueDates.length - 1])) break;
    }
    return streak;
  }

  const completions = await HabitCompletion.find({ habitId, completed: true }).sort({ date: -1 }).lean();
  if (!completions.length) return 0;

  const uniqueDates = [...new Set(completions.map(c => getLocalDateString(c.date)))].sort((a, b) => new Date(b) - new Date(a));
  let streak = 0;
  let cursor = new Date();

  while (true) {
    const target = getLocalDateString(cursor);
    if (uniqueDates.includes(target)) {
      streak += 1;
      cursor = new Date(cursor.getTime() - 86400000);
      continue;
    }
    if (streak > 0) break;
    cursor = new Date(cursor.getTime() - 86400000);
    if (new Date(target) < new Date(uniqueDates[uniqueDates.length - 1])) break;
  }

  return streak;
}

async function getDailyCompletionStatus() {
  if (mongoose.connection.readyState !== 1) {
    const habits = memoryStore.habits.filter(h => h.active !== false);
    const today = getLocalDateString(new Date());
    const completed = new Set(memoryStore.completions.filter(c => c.completed !== false && getLocalDateString(c.date) === today).map(c => String(c.habitId)));
    return habits.map(h => ({ ...h, completed: completed.has(String(h._id)) }));
  }

  const habits = await Habit.find({ active: true }).lean();
  const completions = await HabitCompletion.find({ completed: true }).lean();
  const today = getLocalDateString(new Date());
  const completed = new Set(completions.filter(c => getLocalDateString(c.date) === today).map(c => String(c.habitId)));
  return habits.map(h => ({
    ...h,
    completed: completed.has(String(h._id)),
  }));
}

module.exports = { getHabitSummary, getHabitStreak, getDailyCompletionStatus };
