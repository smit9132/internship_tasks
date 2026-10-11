const alertTypes = new Set(['absence', 'multiple_faces', 'camera', 'detector', 'focus', 'monitoring']);
const severities = new Set(['info', 'warning', 'error']);

export function validateSessionStart(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'startedAt')) {
    return { ok: false, error: 'Only a startedAt timestamp is accepted.' };
  }
  const startedAt = new Date(body.startedAt);
  if (!body.startedAt || Number.isNaN(startedAt.getTime()) || Math.abs(Date.now() - startedAt.getTime()) > 60_000) {
    return { ok: false, error: 'A valid recent startedAt timestamp is required.' };
  }
  return { ok: true, value: { startedAt } };
}

export function validateAlert(body) {
  const allowed = ['type', 'severity', 'description', 'occurredAt', 'faceCount'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !allowed.includes(key))) {
    return { ok: false, error: 'Alert contains unsupported fields.' };
  }
  const occurredAt = new Date(body.occurredAt);
  if (!alertTypes.has(body.type) || !severities.has(body.severity)
    || typeof body.description !== 'string' || body.description.trim().length < 1 || body.description.length > 240
    || Number.isNaN(occurredAt.getTime()) || Math.abs(Date.now() - occurredAt.getTime()) > 86_400_000
    || (body.faceCount !== undefined && body.faceCount !== null && (!Number.isInteger(body.faceCount) || body.faceCount < 0 || body.faceCount > 100))) {
    return { ok: false, error: 'Alert fields are invalid.' };
  }
  return {
    ok: true,
    value: {
      type: body.type,
      severity: body.severity,
      description: body.description.trim(),
      occurredAt,
      faceCount: body.faceCount ?? null
    }
  };
}

export function validateSessionStop(body) {
  const allowed = ['durationSeconds', 'faceEvents', 'status'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !allowed.includes(key))) {
    return { ok: false, error: 'Session summary contains unsupported fields.' };
  }
  if (!Number.isInteger(body.durationSeconds) || body.durationSeconds < 0 || body.durationSeconds > 86_400
    || !Number.isInteger(body.faceEvents) || body.faceEvents < 0 || body.faceEvents > 1_000_000
    || !['completed', 'interrupted'].includes(body.status)) {
    return { ok: false, error: 'Session summary fields are invalid.' };
  }
  return { ok: true, value: { durationSeconds: body.durationSeconds, faceEvents: body.faceEvents, status: body.status } };
}
