import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonitorState, DEFAULT_SETTINGS, validateSettings, summarizeSession, alertsToCsv, requestApiJson, migrateSettings, sessionLimitReached } from '../public/js/monitoring.js';
import { validateAlert, validateSessionStart, validateSessionStop } from '../src/validation.js';

function harness(overrides = {}) {
  let time = 1000;
  const emitted = [];
  const settings = { ...DEFAULT_SETTINGS, cooldown: 0, absenceDelay: 2, multipleDelay: 2, ...overrides };
  return {
    emitted,
    setTime(value) { time = value; },
    monitor: createMonitorState(settings, (event) => emitted.push(event), () => time)
  };
}

test('absence alert waits for the threshold and resolves when a face returns', () => {
  const h = harness();
  h.monitor.update(0);
  h.setTime(2999);
  h.monitor.update(0);
  assert.equal(h.emitted.length, 0);
  h.setTime(3000);
  h.monitor.update(0);
  assert.equal(h.emitted[0].type, 'absence');
  h.monitor.update(1);
  assert.equal(h.emitted[1].action, 'resolve');
});

test('multiple-face alert requires a sustained count above allowed faces', () => {
  const h = harness({ maxFaces: 1 });
  h.monitor.update(1);
  h.setTime(2000);
  h.monitor.update(2);
  h.setTime(3999);
  h.monitor.update(2);
  assert.equal(h.emitted.length, 0);
  h.setTime(4000);
  h.monitor.update(2);
  assert.equal(h.emitted[0].type, 'multiple_faces');
  assert.equal(h.emitted[0].faceCount, 2);
});

test('one alert per continuous condition; cooldown throttles subsequent conditions', () => {
  const h = harness({ cooldown: 10 });
  h.monitor.update(0);
  h.setTime(3000);
  h.monitor.update(0);
  h.monitor.update(0);
  assert.equal(h.emitted.filter((item) => item.action === 'create').length, 1);
  h.monitor.update(1);
  h.setTime(4000);
  h.monitor.update(0);
  h.setTime(7000);
  h.monitor.update(0);
  assert.equal(h.emitted.filter((item) => item.action === 'create').length, 1);
});

test('conditions resolve and reset clears pending conditions', () => {
  const h = harness();
  h.monitor.update(0);
  h.monitor.reset();
  h.setTime(5000);
  h.monitor.update(1);
  assert.equal(h.emitted.length, 0);
});

test('settings accept defaults and reject unsafe or out-of-range values', () => {
  assert.equal(validateSettings(DEFAULT_SETTINGS).ok, true);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, maxFaces: 0 }).ok, false);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, confidence: 1.2 }).ok, false);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, focusEnabled: 'yes' }).ok, false);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, duration: 1 }).ok, true);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, duration: 86_400 }).ok, true);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, duration: 86_401 }).ok, false);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, duration: 1.5 }).ok, false);
});

test('legacy session limits in minutes migrate to seconds without changing their duration', () => {
  assert.equal(migrateSettings({ duration: 10 }).duration, 600);
  assert.equal(migrateSettings({ duration: 60, durationUnit: 'seconds' }).duration, 60);
  assert.equal(migrateSettings({}).duration, undefined);
});

test('session limit triggers at its configured second without a minutes conversion', () => {
  assert.equal(sessionLimitReached(29, 30), false);
  assert.equal(sessionLimitReached(30, 30), true);
  assert.equal(sessionLimitReached(60, 30), true);
});

test('session summary computes elapsed seconds and monitoring event count', () => {
  const result = summarizeSession(0, 10_500, [{ type: 'absence' }, { type: 'focus' }, { type: 'multiple_faces' }]);
  assert.deepEqual(result, { durationSeconds: 10, faceEvents: 2, alertCount: 3 });
});

test('CSV export escapes quotes and emits a stable header', () => {
  const csv = alertsToCsv([{ timestamp: 0, type: 'absence', severity: 'warning', description: 'No face "visible"', faceCount: 0 }]);
  assert.equal(csv.split('\r\n')[0], '"Timestamp","Type","Severity","Description","Face count","Status"');
  assert.match(csv, /"No face ""visible"""/);
});

test('API validators reject unsupported fields and accept narrowly scoped metadata', () => {
  const now = new Date();
  assert.equal(validateSessionStart({ startedAt: now.toISOString(), video: 'no' }).ok, false);
  assert.equal(validateSessionStart({ startedAt: now.toISOString() }).ok, true);
  assert.equal(validateAlert({ type: 'absence', severity: 'warning', description: 'No face.', occurredAt: now.toISOString(), faceCount: 0 }).ok, true);
  assert.equal(validateAlert({ type: 'identity', severity: 'warning', description: 'No face.', occurredAt: now.toISOString() }).ok, false);
  assert.equal(validateSessionStop({ durationSeconds: 20, faceEvents: 2, status: 'completed', secret: true }).ok, false);
});

test('metadata service unavailability is reported without invalidating local detection logic', async () => {
  const result = await requestApiJson(async () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }), '/api/sessions');
  assert.equal(result.available, false);
  const local = harness();
  local.monitor.update(0);
  assert.equal(local.emitted.length, 0);
});

test('network failure makes persistence unavailable while non-503 API errors remain distinguishable', async () => {
  const network = await requestApiJson(async () => { throw new Error('offline'); }, '/api/sessions');
  assert.equal(network.available, false);
  const invalid = await requestApiJson(async () => new Response('{}', { status: 400 }), '/api/sessions');
  assert.equal(invalid.available, true);
  assert.match(invalid.error.message, /400/);
});
