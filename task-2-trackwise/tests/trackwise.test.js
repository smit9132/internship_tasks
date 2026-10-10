const test = require('node:test');
const assert = require('node:assert/strict');

const { parseExpenseCommand, parseTaskCommand, parseHabitCommand, executeIntentIntent } = require('../services/ai/intentEngine');
const { getExpenseStats } = require('../services/expenses/expenseService');
const { memoryStore } = require('../services/store');

function resetMemory() {
  memoryStore.expenses = [];
  memoryStore.habits = [];
  memoryStore.tasks = [];
  memoryStore.completions = [];
}

test('parseExpenseCommand recognizes rupee expenditure', () => {
  const result = parseExpenseCommand('I spent 150 rupees on lunch today');
  assert.ok(result);
  assert.equal(result.type, 'expense');
  assert.equal(result.payload.amount, 150);
  assert.equal(result.payload.category, 'Food');
  assert.equal(result.payload.description, 'lunch');
  assert.equal(result.payload.currency, 'INR');
});

test('parseTaskCommand recognizes task creation intent', async () => {
  const result = await parseTaskCommand('Add task to finish my assignment tomorrow');
  assert.ok(result);
  assert.equal(result.type, 'task');
  assert.match(result.payload.title, /finish my assignment/i);
  assert.equal(result.payload.priority, 'Medium');
});

test('parseHabitCommand ignores habit questions and recognizes completed habits', async () => {
  assert.equal(await parseHabitCommand('What habits do I need to complete today'), null);
  const result = await parseHabitCommand('I completed my workout habit');
  assert.ok(result);
  assert.equal(result.type, 'habit_complete');
  assert.ok(String(result.payload.habitId));
});

test('executeIntentIntent records expense in memory fallback mode', async () => {
  resetMemory();
  const result = await executeIntentIntent('I spent 150 rupees on lunch today');
  assert.equal(result.type, 'expense_created');
  assert.equal(memoryStore.expenses.length, 1);
  assert.equal(memoryStore.expenses[0].amount, 150);
});

test('getExpenseStats returns totals and category breakdown from memory store', async () => {
  resetMemory();
  memoryStore.expenses.push({
    amount: 120,
    category: 'Food',
    description: 'Dinner',
    date: new Date(),
    currency: 'INR',
  });
  const stats = await getExpenseStats();
  assert.ok(stats.todayTotal >= 120);
  assert.ok(stats.monthTotal >= 120);
  assert.ok(stats.categoryBreakdown.some(entry => entry.category === 'Food'));
});
