require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const path = require('path');
const { connectDB } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3001;

const isMongoAvailable = () => mongoose.connection.readyState === 1;

app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const corsOptions = {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many AI requests. Please wait a moment.' }
});

app.use((req, res, next) => {
  if (req.path === '/api/ai/chat') {
    return aiRateLimiter(req, res, next);
  }
  next();
});

app.use('/api', require('./routes/index'));

app.use(express.static(path.join(__dirname, 'public')));
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  const statusCode = err.statusCode || 500;
  const response = {
    success: false,
    message: err.message || 'Something went wrong'
  };
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    response.stack = err.stack;
  }
  res.status(statusCode).json(response);
});

async function startServer() {
  if (!process.env.MONGODB_URI) {
    console.warn('MONGODB_URI is not set. Starting without database connection.');
  } else {
    await connectDB();
    console.log('MongoDB connected successfully');
  }

  return app.listen(PORT, () => {
    console.log(`TrackWise server running on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startServer().catch(error => {
    console.error('TrackWise failed to start:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { app, startServer, isMongoAvailable };
