import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { rateLimit } from 'express-rate-limit';
import { AlertEvent, MonitoringSession } from './src/models.js';
import { validateAlert, validateSessionStart, validateSessionStop } from './src/validation.js';

const app = express();
const port = Number(process.env.PORT) || 3000;
const dirname = path.dirname(fileURLToPath(import.meta.url));
let databaseReady = false;
const allowedIps = new Set((process.env.APP_ALLOWED_IPS || '').split(',').map((ip) => ip.trim()).filter(Boolean));

app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'https://storage.googleapis.com', 'https://cdn.jsdelivr.net'],
      workerSrc: ["'self'", 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    if (!allowedIps.size) return res.status(503).json({ error: 'Production access is restricted until APP_ALLOWED_IPS is configured.' });
    if (!allowedIps.has(req.ip)) return res.status(403).json({ error: 'This demonstration is restricted to an allowed network address.' });
    return next();
  });
}
app.use(express.json({ limit: '32kb', strict: true }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', database: databaseReady ? 'connected' : 'unavailable', persistence: databaseReady });
});

app.get('/api/sessions', async (_req, res, next) => {
  if (!databaseReady) return res.status(503).json({ error: 'Session persistence is unavailable.' });
  try {
    const sessions = await MonitoringSession.find().sort({ startedAt: -1 }).limit(20).lean();
    return res.json({ sessions });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/sessions', async (req, res, next) => {
  const input = validateSessionStart(req.body);
  if (!input.ok) return res.status(400).json({ error: input.error });
  if (!databaseReady) return res.status(503).json({ error: 'Session persistence is unavailable.' });
  try {
    const session = await MonitoringSession.create(input.value);
    return res.status(201).json({ session: { id: session.id, startedAt: session.startedAt } });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/sessions/:id/alerts', async (req, res, next) => {
  const input = validateAlert(req.body);
  if (!input.ok) return res.status(400).json({ error: input.error });
  if (!databaseReady) return res.status(503).json({ error: 'Session persistence is unavailable.' });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid session id.' });
  try {
    const session = await MonitoringSession.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    const alert = await AlertEvent.create({ ...input.value, session: session._id });
    session.alertCount += 1;
    await session.save();
    return res.status(201).json({ alert: { id: alert.id, createdAt: alert.createdAt } });
  } catch (error) {
    return next(error);
  }
});

app.patch('/api/sessions/:id/alerts/:alertId', async (req, res, next) => {
  const allowed = ['state'];
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || Object.keys(req.body).some((key) => !allowed.includes(key))
    || !['resolved', 'acknowledged'].includes(req.body.state)) {
    return res.status(400).json({ error: 'Alert state is invalid.' });
  }
  if (!databaseReady) return res.status(503).json({ error: 'Session persistence is unavailable.' });
  if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.alertId)) {
    return res.status(400).json({ error: 'Invalid session or alert id.' });
  }
  try {
    const alert = await AlertEvent.findOne({ _id: req.params.alertId, session: req.params.id });
    if (!alert) return res.status(404).json({ error: 'Alert not found.' });
    if (req.body.state === 'resolved') alert.resolvedAt = new Date();
    else alert.acknowledged = true;
    await alert.save();
    return res.json({ updated: true });
  } catch (error) {
    return next(error);
  }
});

app.patch('/api/sessions/:id/stop', async (req, res, next) => {
  const input = validateSessionStop(req.body);
  if (!input.ok) return res.status(400).json({ error: input.error });
  if (!databaseReady) return res.status(503).json({ error: 'Session persistence is unavailable.' });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid session id.' });
  try {
    const session = await MonitoringSession.findByIdAndUpdate(req.params.id, {
      $set: { endedAt: new Date(), durationSeconds: input.value.durationSeconds, faceEvents: input.value.faceEvents, status: input.value.status }
    }, { new: true, runValidators: true }).select('_id endedAt durationSeconds status');
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    return res.json({ session });
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/sessions', async (_req, res, next) => {
  if (!databaseReady) return res.status(503).json({ error: 'Session persistence is unavailable.' });
  try {
    await AlertEvent.deleteMany({});
    await MonitoringSession.deleteMany({ status: { $ne: 'active' } });
    await MonitoringSession.updateMany({ status: 'active' }, { $set: { alertCount: 0 } });
    return res.json({ deleted: true });
  } catch (error) {
    return next(error);
  }
});

app.use(express.static(path.join(dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(dirname, 'public', 'index.html')));

app.use((error, _req, res, _next) => {
  console.error('Request failed:', error.message);
  if (res.headersSent) return;
  const status = error.type === 'entity.too.large' ? 413 : 500;
  res.status(status).json({ error: status === 413 ? 'Request body is too large.' : 'The request could not be completed.' });
});

if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => { databaseReady = true; console.info('MongoDB connected; metadata persistence enabled.'); })
    .catch((error) => console.error(`MongoDB unavailable; continuing without persistence: ${error.message}`));
  mongoose.connection.on('disconnected', () => { databaseReady = false; });
  mongoose.connection.on('connected', () => { databaseReady = true; });
} else {
  console.info('MONGODB_URI not set; running without session persistence.');
}

app.listen(port, () => console.info(`Vision Guard listening on http://localhost:${port}`));

export { app };
