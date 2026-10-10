require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const { connectDatabase } = require('./config/database');
const { requireCsrf } = require('./middleware/auth');
const { errorHandler, HttpError } = require('./utils/errors');

function createApp() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
  const app = express();
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"]
      }
    }
  }));
  const origins = (process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
  app.use((req, res, next) => cors({
    credentials: true,
    origin(origin, callback) {
      const requestOrigin = `${req.protocol}://${req.get('host')}`;
      if (!origin || origins.includes(origin) || origin === requestOrigin) return callback(null, true);
      return callback(null, false);
    }
  })(req, res, next));
  app.use(express.json({ limit: '30kb' }));
  app.use(session({
    name: 'eventsync.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ client: require('mongoose').connection.getClient(), collectionName: 'sessions', ttl: 60 * 60 * 24 * 7 }),
    cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 }
  }));
  app.use('/api', requireCsrf);

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: process.env.NODE_ENV === 'test' ? 1000 : 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait and try again.' }
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/events', require('./routes/events'));
  app.use('/api/dashboard', require('./routes/dashboard'));
  app.use('/api/admin', require('./routes/admin'));

  app.get('/api/health', (req, res) => {
    const connected = require('mongoose').connection.readyState === 1;
    res.status(connected ? 200 : 503).json({ status: connected ? 'ok' : 'unavailable', database: connected ? 'connected' : 'disconnected' });
  });
  app.use(express.static(require('node:path').join(__dirname, 'public'), { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  app.use((req, res) => res.status(404).sendFile(require('node:path').join(__dirname, 'public', '404.html')));
  app.use(errorHandler);
  return app;
}

async function start() {
  await connectDatabase();
  const app = createApp();
  const port = Number.parseInt(process.env.PORT, 10) || 3000;
  const server = app.listen(port, () => console.log(`EventSync listening on port ${port}`));
  const shutdown = () => server.close(() => require('mongoose').disconnect().finally(() => process.exit(0)));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    console.error(`EventSync startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createApp, start };
