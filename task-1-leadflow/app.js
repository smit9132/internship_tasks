const express = require('express');
const mongoose = require('mongoose');

const errorHandler = require('./middleware/errorHandler');
const leadRoutes = require('./routes/leadRoutes');

const app = express();

app.use(express.json({ limit: '10kb' }));

app.get('/api/health', (req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;

  res.status(databaseConnected ? 200 : 503).json({
    success: databaseConnected,
    data: {
      status: databaseConnected ? 'ok' : 'unavailable',
      database: databaseConnected ? 'connected' : 'disconnected',
    },
  });
});

app.use('/api/leads', leadRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: 'Route not found.',
    },
  });
});

app.use(errorHandler);

module.exports = app;
