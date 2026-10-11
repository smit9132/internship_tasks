export const DEFAULT_SETTINGS = Object.freeze({
  absenceDelay: 10,
  multipleDelay: 5,
  maxFaces: 1,
  confidence: 0.55,
  cooldown: 15,
  duration: 3600,
  focusEnabled: false
});

export function validateSettings(input) {
  const rules = {
    absenceDelay: [1, 300], multipleDelay: [1, 300], maxFaces: [1, 10],
    confidence: [0.1, 0.99], cooldown: [0, 300], duration: [1, 86_400]
  };
  for (const [key, [min, max]] of Object.entries(rules)) {
    const value = Number(input[key]);
    if (!Number.isFinite(value) || value < min || value > max || (key !== 'confidence' && !Number.isInteger(value))) {
      return { ok: false, error: `${key} must be between ${min} and ${max}${key === 'confidence' ? '' : ' (whole numbers only)'}.` };
    }
  }
  if (typeof input.focusEnabled !== 'boolean') return { ok: false, error: 'focusEnabled must be a boolean.' };
  return {
    ok: true,
    value: {
      absenceDelay: Number(input.absenceDelay), multipleDelay: Number(input.multipleDelay),
      maxFaces: Number(input.maxFaces), confidence: Number(input.confidence),
      cooldown: Number(input.cooldown), duration: Number(input.duration), focusEnabled: input.focusEnabled
    }
  };
}

export function migrateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  if (input.durationUnit === 'seconds' || !Object.hasOwn(input, 'duration')) return input;
  const duration = Number(input.duration);
  return {
    ...input,
    duration: Number.isFinite(duration) ? duration * 60 : input.duration,
    durationUnit: 'seconds'
  };
}

export function sessionLimitReached(elapsedSeconds, limitSeconds) {
  return elapsedSeconds >= limitSeconds;
}

export function createMonitorState(settings, emit, now = () => Date.now()) {
  const conditions = {
    absence: { since: null, activeId: null },
    multiple_faces: { since: null, activeId: null }
  };
  const lastEmitted = new Map();

  function updateCondition(type, isActive, delayMs, faceCount, time = now()) {
    const condition = conditions[type];
    if (!isActive) {
      if (condition.activeId) emit({ action: 'resolve', id: condition.activeId, resolvedAt: time });
      condition.since = null;
      condition.activeId = null;
      return;
    }
    if (condition.since === null) condition.since = time;
    if (condition.activeId || time - condition.since < delayMs) return;
    const last = lastEmitted.get(type) ?? -Infinity;
    if (time - last < settings.cooldown * 1000) return;
    const id = `${type}-${time}`;
    condition.activeId = id;
    lastEmitted.set(type, time);
    emit({
      action: 'create', id, type, faceCount,
      severity: 'warning', timestamp: time,
      description: type === 'absence' ? 'No face detected beyond the configured delay.' : `More than ${settings.maxFaces} face(s) detected beyond the configured delay.`
    });
  }

  return {
    update(faceCount, timestamp = now()) {
      updateCondition('absence', faceCount === 0, settings.absenceDelay * 1000, faceCount, timestamp);
      updateCondition('multiple_faces', faceCount > settings.maxFaces, settings.multipleDelay * 1000, faceCount, timestamp);
    },
    reset() {
      for (const type of Object.keys(conditions)) updateCondition(type, false, 0, null);
      conditions.absence.since = null;
      conditions.multiple_faces.since = null;
    }
  };
}

export function summarizeSession(startedAt, endedAt, events) {
  const durationSeconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  const faceEvents = events.filter((event) => event.type === 'absence' || event.type === 'multiple_faces').length;
  return { durationSeconds, faceEvents, alertCount: events.length };
}

export function alertsToCsv(events) {
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['Timestamp', 'Type', 'Severity', 'Description', 'Face count', 'Status']];
  for (const event of events) {
    rows.push([
      new Date(event.timestamp).toISOString(), event.type, event.severity, event.description,
      event.faceCount ?? '', event.resolvedAt ? 'resolved' : (event.acknowledged ? 'acknowledged' : 'active')
    ]);
  }
  return rows.map((row) => row.map(quote).join(',')).join('\r\n');
}

export async function requestApiJson(fetcher, url, options = {}) {
  let response;
  try {
    response = await fetcher(url, options);
  } catch (error) {
    return { available: false, error };
  }
  if (response.status === 503) return { available: false, error: new Error('Persistence service unavailable.') };
  if (!response.ok) return { available: true, error: new Error(`API request failed (${response.status}).`) };
  try {
    return { available: true, data: await response.json() };
  } catch (error) {
    return { available: true, error };
  }
}
