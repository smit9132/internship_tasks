const express = require('express');
const { notFoundHandler, errorHandler } = require('../middleware/errorHandler');
const expenseRoutes = require('./expenses');
const habitRoutes = require('./habits');
const taskRoutes = require('./tasks');
const aiRoutes = require('./ai');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ success: true, message: 'TrackWise API is running', timestamp: new Date().toISOString() });
});

router.get('/status', async (req, res) => {
  const dbState = require('mongoose').connection.readyState;
  res.json({
    success: true,
    database: {
      status: dbState === 1 ? 'connected' : 'disconnected',
      readyState: dbState,
    },
    ai: {
      provider: process.env.OLLAMA_BASE_URL ? 'ollama' : 'local-fallback',
      configured: !!process.env.OLLAMA_BASE_URL,
      model: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
    },
    timezone: 'Assumes local machine timezone for all date calculations and displays.',
  });
});

router.use('/expenses', expenseRoutes);
router.use('/habits', habitRoutes);
router.use('/tasks', taskRoutes);
router.use('/ai', aiRoutes);
router.get('/dashboard', require('../controllers/dashboardController').getDashboardSummary);

router.use(notFoundHandler);
router.use(errorHandler);

module.exports = router;
