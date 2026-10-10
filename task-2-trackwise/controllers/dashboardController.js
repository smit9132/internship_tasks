const mongoose = require('mongoose');
const { memoryStore } = require('../services/store');
const { getExpenseStats } = require('../services/expenses/expenseService');
const { getTaskOverview } = require('../services/tasks/taskService');
const { getHabitSummary } = require('../services/habits/habitService');

async function getDashboardSummary(req, res, next) {
  try {
    const [expensesStats, taskOverview, habitSummary] = await Promise.all([
      getExpenseStats(),
      getTaskOverview(),
      getHabitSummary(),
    ]);

    let recentExpenses = expensesStats.recentExpenses || [];
    let taskData = taskOverview.upcoming || [];
    let totalHabits = habitSummary.activeHabits?.length || 0;
    let completedHabitIds = [];

    if (mongoose.connection.readyState === 1) {
      const Expense = require('../models/Expense');
      const Task = require('../models/Task');
      const Habit = require('../models/Habit');
      const HabitCompletion = require('../models/HabitCompletion');

      taskData = await Task.find({ dueDate: { $ne: null } }).sort({ dueDate: 1 }).limit(5).lean();
      recentExpenses = await Expense.find().sort({ date: -1 }).limit(5).lean();
      totalHabits = await Habit.countDocuments({ active: true });
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      const habitCompletionCheck = await HabitCompletion.find({ date: { $gte: start, $lte: end } }).lean();
      completedHabitIds = [...new Set(habitCompletionCheck.map(c => String(c.habitId)))];
    } else {
      recentExpenses = [...memoryStore.expenses].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
      taskData = [...memoryStore.tasks].filter(task => task.dueDate).sort((a, b) => new Date(a.dueDate || '9999-12-31') - new Date(b.dueDate || '9999-12-31')).slice(0, 5);
      totalHabits = memoryStore.habits.filter(h => h.active !== false).length;
      const today = new Date();
      completedHabitIds = [...new Set(memoryStore.completions.filter(c => {
        const d = new Date(c.date);
        return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
      }).map(c => String(c.habitId)))];
    }

    res.json({
      success: true,
      data: {
        todaySpending: expensesStats.todayTotal,
        monthSpending: expensesStats.monthTotal,
        activeHabits: totalHabits,
        completionRate: habitSummary.completionRate,
        pendingTasks: taskOverview.pending,
        overdueTasks: taskOverview.overdue,
        recentExpenses,
        upcomingTasks: taskData,
        categoryBreakdown: expensesStats.categoryBreakdown,
        monthlyTrend: expensesStats.monthlyTrend,
        completedToday: habitSummary.completedToday,
        completedHabitIds,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getDashboardSummary };
