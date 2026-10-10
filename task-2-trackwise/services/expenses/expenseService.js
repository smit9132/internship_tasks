const mongoose = require('mongoose');
const Expense = require('../../models/Expense');
const { memoryStore } = require('../store');

function normalizeDate(dateValue) {
  if (!dateValue) return new Date();
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) {
    throw new Error('Invalid date value');
  }
  return d;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date) {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function startOfMonth(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function getMemoryExpenses() {
  return [...memoryStore.expenses].sort((a, b) => new Date(b.date) - new Date(a.date));
}

function getDaysBetween(start, end) {
  const difference = new Date(end).getTime() - new Date(start).getTime();
  return difference / (1000 * 60 * 60 * 24);
}

async function getExpenseStats() {
  if (mongoose.connection.readyState !== 1) {
    const list = getMemoryExpenses();
    const today = new Date();
    const startOfToday = startOfDay(today);
    const weekStart = startOfWeek(today);
    const monthStart = startOfMonth(today);
    const monthEnd = endOfMonth(today);
    const categoryMap = {};
    let todayTotal = 0;
    let weekTotal = 0;
    let monthTotal = 0;

    for (const item of list) {
      const itemDate = new Date(item.date);
      if (itemDate >= startOfToday && itemDate <= new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)) todayTotal += Number(item.amount || 0);
      if (itemDate >= weekStart && itemDate <= new Date()) weekTotal += Number(item.amount || 0);
      if (itemDate >= monthStart && itemDate <= monthEnd) monthTotal += Number(item.amount || 0);
      categoryMap[item.category] = (categoryMap[item.category] || 0) + Number(item.amount || 0);
    }

    return {
      todayTotal,
      weekTotal,
      monthTotal,
      categoryBreakdown: Object.entries(categoryMap).map(([category, total]) => ({ category, total })),
      recentExpenses: list.slice(0, 5),
      monthlyTrend: (() => {
        const months = [];
        for (let i = 5; i >= 0; i -= 1) {
          const point = new Date(today.getFullYear(), today.getMonth() - i, 1);
          const monthKey = `${point.getFullYear()}-${String(point.getMonth() + 1).padStart(2, '0')}`;
          const filtered = list.filter((exp) => {
            const d = new Date(exp.date);
            return d.getFullYear() === point.getFullYear() && d.getMonth() === point.getMonth();
          });
          months.push({ month: monthKey, total: filtered.reduce((sum, e) => sum + Number(e.amount || 0), 0) });
        }
        return months;
      })(),
    };
  }

  const today = new Date();
  const start = startOfDay(today);
  const end = new Date(today); end.setHours(23,59,59,999);
  const weekStart = startOfWeek(today);
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);

  const [todayTotal, weekTotal, monthTotal, categoryBreakdown, recent, monthlyTrend] = await Promise.all([
    Expense.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]),
    Expense.aggregate([
      { $match: { date: { $gte: weekStart, $lte: end } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]),
    Expense.aggregate([
      { $match: { date: { $gte: monthStart, $lte: monthEnd } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]),
    Expense.aggregate([
      { $match: {} },
      { $group: { _id: '$category', total: { $sum: '$amount' } } },
      { $sort: { total: -1 } }
    ]),
    Expense.find().sort({ date: -1, createdAt: -1 }).limit(5).lean(),
    Expense.aggregate([
      { $match: { date: { $gte: new Date(today.getFullYear(), today.getMonth() - 5, 1), $lte: monthEnd } } },
      { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' } }, total: { $sum: '$amount' } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ])
  ]);

  return {
    todayTotal: todayTotal[0]?.total || 0,
    weekTotal: weekTotal[0]?.total || 0,
    monthTotal: monthTotal[0]?.total || 0,
    categoryBreakdown: categoryBreakdown.map(item => ({ category: item._id, total: item.total })),
    recentExpenses: recent,
    monthlyTrend: monthlyTrend.map(item => ({
      month: `${item._id.year}-${String(item._id.month).padStart(2, '0')}`,
      total: item.total,
    })),
  };
}

async function getExpenseSearch(filters = {}) {
  if (mongoose.connection.readyState !== 1) {
    let list = getMemoryExpenses();
    if (filters.category) {
      list = list.filter(item => item.category === filters.category);
    }
    if (filters.description) {
      const term = String(filters.description).toLowerCase();
      list = list.filter(item => item.description.toLowerCase().includes(term));
    }
    if (filters.startDate) {
      list = list.filter(item => new Date(item.date) >= new Date(filters.startDate));
    }
    if (filters.endDate) {
      list = list.filter(item => new Date(item.date) <= new Date(filters.endDate));
    }
    return list;
  }

  const query = {};
  if (filters.category) query.category = filters.category;
  if (filters.description) query.description = { $regex: filters.description, $options: 'i' };
  if (filters.startDate || filters.endDate) {
    query.date = {};
    if (filters.startDate) query.date.$gte = normalizeDate(filters.startDate);
    if (filters.endDate) query.date.$lte = normalizeDate(filters.endDate);
  }
  return Expense.find(query).sort({ date: -1 }).lean();
}

module.exports = { normalizeDate, getExpenseStats, getExpenseSearch };
