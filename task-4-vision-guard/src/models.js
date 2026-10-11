import mongoose from 'mongoose';

const monitoringSessionSchema = new mongoose.Schema({
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
  durationSeconds: { type: Number, default: 0, min: 0, max: 86_400 },
  faceEvents: { type: Number, default: 0, min: 0, max: 1_000_000 },
  alertCount: { type: Number, default: 0, min: 0, max: 1_000_000 },
  status: { type: String, enum: ['active', 'completed', 'interrupted'], default: 'active' }
}, { timestamps: true, strict: 'throw' });

const alertEventSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'MonitoringSession', required: true, index: true },
  type: { type: String, enum: ['absence', 'multiple_faces', 'camera', 'detector', 'focus', 'monitoring'], required: true },
  severity: { type: String, enum: ['info', 'warning', 'error'], required: true },
  description: { type: String, required: true, maxlength: 240 },
  occurredAt: { type: Date, required: true },
  faceCount: { type: Number, min: 0, max: 100, default: null },
  resolvedAt: { type: Date, default: null },
  acknowledged: { type: Boolean, default: false }
}, { timestamps: true, strict: 'throw' });

export const MonitoringSession = mongoose.models.MonitoringSession
  || mongoose.model('MonitoringSession', monitoringSessionSchema);
export const AlertEvent = mongoose.models.AlertEvent || mongoose.model('AlertEvent', alertEventSchema);
