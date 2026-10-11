import { createMonitorState, DEFAULT_SETTINGS, validateSettings, summarizeSession, alertsToCsv, requestApiJson, migrateSettings, sessionLimitReached } from './monitoring.js';

const $ = (id) => document.getElementById(id);
const video = $('camera-video');
const canvas = $('detection-canvas');
const ctx = canvas.getContext('2d');
const events = [];
let settings = loadSettings();
let detector;
let stream;
let monitor;
let animationFrame;
let sessionStartedAt = 0;
let sessionId;
let elapsedTimer;
let frameCount = 0;
let lastFrameAt = 0;
let fpsSamples = [];
let isRunning = false;
let isStarting = false;
let startAttempt = 0;
let cameraDevices = [];
let cameraDeviceIndex = 0;
let lastFocusAlert = 0;
let currentFaceCount = null;
let sessionAlertStart = 0;
let lastVideoTime = -1;
let lastVideoProgressAt = 0;
let videoStalled = false;

function loadSettings() {
  try {
    const raw = localStorage.getItem('visionGuardSettings');
    const parsed = migrateSettings(JSON.parse(raw || '{}'));
    const checked = validateSettings({ ...DEFAULT_SETTINGS, ...parsed });
    if (raw && parsed.durationUnit === 'seconds') {
      const { durationUnit, ...settingsToSave } = parsed;
      localStorage.setItem('visionGuardSettings', JSON.stringify({ ...settingsToSave, durationUnit }));
    }
    return checked.ok ? checked.value : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  const checked = validateSettings(readFormSettings());
  if (!checked.ok) {
    toast(checked.error, 'error');
    return;
  }
  settings = checked.value;
  try {
    localStorage.setItem('visionGuardSettings', JSON.stringify({ ...settings, durationUnit: 'seconds' }));
    toast('Monitoring preferences saved for this browser.', 'success');
  } catch (error) {
    console.warn('Could not persist Vision Guard preferences:', error.message);
    toast('Preferences are active for this page but could not be saved in this browser.', 'error');
  }
}

function readFormSettings() {
  return {
    absenceDelay: $('absence-delay').value,
    multipleDelay: $('multiple-delay').value,
    maxFaces: $('max-faces').value,
    confidence: $('confidence').value,
    cooldown: $('cooldown').value,
    duration: $('duration').value,
    focusEnabled: $('focus-enabled').checked
  };
}

function renderSettings() {
  $('absence-delay').value = settings.absenceDelay;
  $('multiple-delay').value = settings.multipleDelay;
  $('max-faces').value = settings.maxFaces;
  $('confidence').value = settings.confidence;
  $('cooldown').value = settings.cooldown;
  $('duration').value = settings.duration;
  $('focus-enabled').checked = settings.focusEnabled;
}

function toast(message, kind = 'info') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  $('toast-region').append(node);
  setTimeout(() => node.remove(), 4500);
}

async function checkHealth() {
  try {
    const response = await fetch('/api/health');
    const health = await response.json();
    $('api-dot').classList.toggle('online', health.persistence);
    $('api-label').textContent = health.persistence ? 'Session storage connected' : 'Session storage unavailable';
    $('event-footer-copy').textContent = health.persistence
      ? 'Alert feed is in this page session; session metadata is stored by the server.'
      : 'Session history is not persisted; core camera detection works without the backend.';
    if (!health.persistence) $('api-dot').classList.add('offline');
  } catch {
    $('api-dot').classList.add('offline');
    $('api-label').textContent = 'Server connection unavailable';
    $('event-footer-copy').textContent = 'Backend unavailable. Detection still works; alert history is in this page session.';
  }
}

async function startMonitoring() {
  if (isRunning || isStarting) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraError('This browser does not support camera access. Use a current browser on localhost or a secure HTTPS site.');
    return;
  }
  const attempt = ++startAttempt;
  isStarting = true;
  clearCameraError();
  setCameraUi('requesting');
  $('start-monitoring').disabled = true;
  $('start-monitoring').classList.add('hidden');
  $('stop-monitoring').classList.remove('hidden');
  $('metric-status').textContent = 'Initializing';
  $('session-label').textContent = 'Preparing local detector';
  $('detector-status').textContent = 'Waiting for camera permission';
  $('live-pill').innerHTML = '<i></i> INITIALIZING';
  $('camera-placeholder-title').textContent = 'Connecting to camera…';
  $('camera-placeholder-copy').textContent = 'Your browser will ask for permission.';
  try {
    const requestedStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: cameraDevices[cameraDeviceIndex]?.deviceId
        ? { deviceId: { exact: cameraDevices[cameraDeviceIndex].deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    if (attempt !== startAttempt) {
      requestedStream.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = requestedStream;
    video.srcObject = stream;
    await video.play();
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        if (!isRunning && !isStarting) return;
        addEvent({ type: 'camera', severity: 'error', description: 'Camera disconnected during monitoring.', timestamp: Date.now() });
        stopMonitoring('interrupted');
        showCameraError('The camera disconnected. Reconnect it and start monitoring again.');
      }, { once: true });
      if (track.readyState === 'ended') {
        addEvent({ type: 'camera', severity: 'error', description: 'Camera disconnected during monitoring setup.', timestamp: Date.now() });
        stopMonitoring('interrupted');
        showCameraError('The camera disconnected. Reconnect it and start monitoring again.');
        return;
      }
    }
    if (attempt !== startAttempt) return;
    $('camera-placeholder').classList.add('hidden');
    setCameraUi('active');
    $('detector-status').textContent = 'Loading local face detector';
    await initializeDetector();
    if (attempt !== startAttempt || !isStarting) {
      detector?.close();
      detector = null;
      return;
    }
    isStarting = false;
    isRunning = true;
    sessionStartedAt = Date.now();
    lastFrameAt = 0;
    sessionAlertStart = events.length;
    currentFaceCount = null;
    monitor = createMonitorState(settings, onConditionEvent);
    const startResponse = await safeApi('/api/sessions', {
      method: 'POST', body: JSON.stringify({ startedAt: new Date(sessionStartedAt).toISOString() })
    });
    if (attempt !== startAttempt || !isRunning) {
      const lateSessionId = startResponse?.session?.id;
      if (lateSessionId) {
        void safeApi(`/api/sessions/${lateSessionId}/stop`, {
          method: 'PATCH',
          body: JSON.stringify({ durationSeconds: Math.floor((Date.now() - sessionStartedAt) / 1000), faceEvents: 0, status: 'interrupted' })
        }).then(() => refreshSessions());
      }
      return;
    }
    sessionId = startResponse?.session?.id ?? null;
    $('metric-status').textContent = 'Monitoring';
    $('session-label').textContent = 'Session active';
    $('metric-faces').textContent = '0';
    $('face-status').textContent = 'Initializing';
    $('live-pill').innerHTML = '<i></i> LIVE';
    $('overlay-detection').textContent = 'DETECTOR READY';
    $('start-monitoring').classList.add('hidden');
    $('stop-monitoring').classList.remove('hidden');
    $('switch-camera').disabled = false;
    setCameraUi('active');
    addEvent({ type: 'monitoring', severity: 'info', description: 'Monitoring session started.', timestamp: Date.now() });
    void refreshSessions();
    if (!sessionId) toast('Session storage is unavailable. Live monitoring continues locally.', 'info');
    elapsedTimer = setInterval(updateElapsed, 1000);
    animationFrame = requestAnimationFrame(processFrame);
  } catch (error) {
    if (attempt !== startAttempt) return;
    isStarting = false;
    cleanupCamera();
    $('start-monitoring').disabled = false;
    $('start-monitoring').classList.remove('hidden');
    $('stop-monitoring').classList.add('hidden');
    $('metric-status').textContent = 'Standby';
    $('session-label').textContent = 'No active session';
    $('live-pill').innerHTML = '<i></i> OFFLINE';
    $('engine-state').textContent = 'STANDBY';
    $('model-status').textContent = 'Not loaded';
    setCameraUi('off');
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      showCameraError('Camera permission was denied or blocked. Allow access in your browser’s site settings, then try again.');
    } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      showCameraError('No camera was found. Connect a camera and try again.');
    } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      showCameraError('The camera is unavailable or already in use by another application. Close other camera apps and try again.');
    } else if (error.message?.includes('model') || error.message?.includes('Failed to fetch') || error.message?.includes('fetch')) {
      showCameraError(`The face-detection model could not load: ${error.message}. Check your internet connection or CDN access and retry.`);
      addEvent({ type: 'detector', severity: 'error', description: `Detector unavailable: ${error.message.slice(0, 160)}`, timestamp: Date.now() });
    } else {
      showCameraError(`Could not start monitoring: ${error.message || 'Unexpected camera error.'}`);
      addEvent({ type: 'camera', severity: 'error', description: 'Camera or detector failed to initialize.', timestamp: Date.now() });
    }
  }
}

async function initializeDetector() {
  $('engine-state').textContent = 'LOADING';
  $('model-status').textContent = 'Loading model…';
  $('detector-status').textContent = 'Loading local detector model…';
  try {
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm');
    const files = await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm');
    const options = {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
      },
      runningMode: 'VIDEO',
      minDetectionConfidence: settings.confidence
    };
    try {
      detector = await vision.FaceDetector.createFromOptions(files, {
        ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' }
      });
    } catch (gpuError) {
      console.warn('GPU delegate unavailable; retrying face detection on CPU:', gpuError.message);
      detector = await vision.FaceDetector.createFromOptions(files, options);
    }
    $('model-status').textContent = 'Ready · MediaPipe';
    $('engine-state').textContent = 'ACTIVE';
  } catch (error) {
    detector = null;
    lastVideoTime = -1;
    lastVideoProgressAt = 0;
    videoStalled = false;
    $('model-status').textContent = 'Unavailable';
    $('engine-state').textContent = 'ERROR';
    throw new Error(`model could not load. ${error.message}`);
  }
}

function processFrame() {
  if (!isRunning || !detector || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    if (isRunning) animationFrame = requestAnimationFrame(processFrame);
    return;
  }
  const progressTime = Date.now();
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    lastVideoProgressAt = progressTime;
    if (videoStalled) {
      videoStalled = false;
      monitor = createMonitorState(settings, onConditionEvent);
      addEvent({ type: 'camera', severity: 'info', description: 'Camera video resumed after a brief stall.', timestamp: progressTime });
    }
  } else if (!videoStalled && lastVideoProgressAt && progressTime - lastVideoProgressAt >= 3000) {
    videoStalled = true;
    monitor.reset();
    $('video-health').textContent = 'Video stalled';
    $('detector-status').textContent = 'Waiting for camera frames';
    $('overlay-detection').textContent = 'VIDEO STALLED';
    addEvent({ type: 'camera', severity: 'error', description: 'Camera video stopped updating. Face absence is not inferred while video is stalled.', timestamp: progressTime });
  }
  if (videoStalled) {
    animationFrame = requestAnimationFrame(processFrame);
    return;
  }
  try {
    const now = performance.now();
    const result = detector.detectForVideo(video, now);
    const wallTime = Date.now();
    if (lastFrameAt && wallTime - lastFrameAt > 2000) monitor.reset();
    frameCount += 1;
    lastFrameAt = wallTime;
    const detections = (result.detections || []).filter((face) =>
      (face.categories?.[0]?.score ?? 1) >= settings.confidence);
    currentFaceCount = detections.length;
    monitor.update(currentFaceCount);
    updateFaceUi(detections);
    const sampleTime = performance.now();
    fpsSamples.push(sampleTime);
    fpsSamples = fpsSamples.filter((time) => sampleTime - time < 3000);
    const fps = fpsSamples.length > 1
      ? Math.round((fpsSamples.length - 1) * 1000 / (fpsSamples.at(-1) - fpsSamples[0]))
      : 0;
    $('video-health').textContent = `${fps} fps`;
    $('detector-status').textContent = 'Detecting locally';
    $('overlay-detection').textContent = `${currentFaceCount} FACE${currentFaceCount === 1 ? '' : 'S'} · LOCAL`;
  } catch (error) {
    detector = null;
    $('engine-state').textContent = 'ERROR';
    $('model-status').textContent = 'Inference error';
    $('detector-status').textContent = 'Detector unavailable';
    $('overlay-detection').textContent = 'DETECTOR ERROR';
    monitor.reset();
    addEvent({ type: 'detector', severity: 'error', description: `Face detection failed: ${error.message.slice(0, 160)}`, timestamp: Date.now() });
    showCameraError('The detector encountered an error. The camera preview remains on; stop and restart monitoring to retry detection.');
    return;
  }
  animationFrame = requestAnimationFrame(processFrame);
}

function updateFaceUi(detections) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.clearRect(0, 0, width, height);
  detections.forEach((face, index) => {
    const box = face.boundingBox;
    if (!box) return;
    ctx.strokeStyle = '#77e7b0';
    ctx.lineWidth = Math.max(3, width / 300);
    ctx.strokeRect(box.originX, box.originY, box.width, box.height);
    const label = `FACE ${index + 1} · ${Math.round((face.categories?.[0]?.score ?? 0) * 100)}%`;
    ctx.font = `600 ${Math.max(15, width / 45)}px Inter, sans-serif`;
    const labelWidth = ctx.measureText(label).width + 18;
    ctx.fillStyle = '#77e7b0';
    ctx.fillRect(box.originX, Math.max(0, box.originY - 31), labelWidth, 29);
    ctx.fillStyle = '#10211a';
    ctx.fillText(label, box.originX + 9, Math.max(20, box.originY - 10));
  });
  $('metric-faces').textContent = detections.length;
  $('detail-face-count').textContent = detections.length;
  $('overlay-face-count').textContent = `${detections.length} face${detections.length === 1 ? '' : 's'}`;
  $('face-status').textContent = detections.length === 0 ? 'No face detected' : detections.length === 1 ? 'One face detected' : 'Multiple faces detected';
  $('detection-title').textContent = detections.length === 0 ? 'No face detected' : detections.length === 1 ? 'One face detected' : 'Multiple faces detected';
  $('detection-copy').textContent = detections.length === 0
    ? 'No face is visible in the current frame.'
    : `${detections.length} face${detections.length === 1 ? '' : 's'} currently visible.`;
  $('detection-icon').textContent = detections.length ? '◎' : '⌕';
}

function onConditionEvent(event) {
  if (event.action === 'resolve') {
    const target = events.find((item) => item.id === event.id);
    if (target) {
      target.resolvedAt = event.resolvedAt;
      persistEventState(target, 'resolved');
    }
    renderEvents();
    return;
  }
  addEvent({ ...event, timestamp: event.timestamp, id: event.id });
}

function addEvent(input) {
  const item = { acknowledged: false, resolvedAt: null, persistenceSessionId: sessionId, ...input };
  events.unshift(item);
  renderEvents();
  if (item.persistenceSessionId && item.type) {
    const activeSessionId = item.persistenceSessionId;
    void safeApi(`/api/sessions/${activeSessionId}/alerts`, {
      method: 'POST',
      body: JSON.stringify({
        type: item.type, severity: item.severity, description: item.description,
        occurredAt: new Date(item.timestamp).toISOString(), faceCount: item.faceCount
      })
    }).then((result) => {
      item.persistenceId = result?.alert?.id;
      if (item.persistenceId && item.resolvedAt) persistEventState(item, 'resolved');
      else if (item.persistenceId && item.acknowledged) persistEventState(item, 'acknowledged');
    });
  }
  return item;
}

function persistEventState(event, state) {
  if (!event.persistenceId || !event.persistenceSessionId) return;
  void safeApi(`/api/sessions/${event.persistenceSessionId}/alerts/${event.persistenceId}`, {
    method: 'PATCH', body: JSON.stringify({ state })
  });
}

function renderEvents() {
  const type = $('filter-type').value;
  const status = $('filter-status').value;
  const filtered = events.filter((event) => {
    const state = event.resolvedAt ? 'resolved' : event.acknowledged ? 'acknowledged' : 'active';
    return (type === 'all' || event.type === type) && (status === 'all' || state === status);
  });
  $('event-count').textContent = events.length;
  $('nav-alert-count').textContent = events.filter((event) => event.severity !== 'info').length;
  const sessionEvents = events.slice(0, Math.max(0, events.length - sessionAlertStart));
  const absenceCount = sessionEvents.filter((event) => event.type === 'absence').length;
  const multipleCount = sessionEvents.filter((event) => event.type === 'multiple_faces').length;
  $('metric-alerts').textContent = sessionEvents.length;
  $('alert-summary').textContent = sessionEvents.length
    ? `${absenceCount} absence · ${multipleCount} multiple-face events`
    : 'No events recorded';
  const list = $('event-list');
  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<span>◷</span><strong>No matching events</strong><p>Try another filter or start monitoring.</p>';
    list.append(empty);
    return;
  }
  filtered.forEach((event) => {
    const row = document.createElement('article');
    row.className = 'event-row';
    const badge = document.createElement('span');
    badge.className = `severity-badge ${event.severity}`;
    badge.textContent = event.severity;
    const body = document.createElement('div');
    body.className = 'event-body';
    const title = document.createElement('strong');
    title.textContent = event.description;
    const meta = document.createElement('small');
    meta.textContent = `${typeLabel(event.type)} · ${new Date(event.timestamp).toLocaleString()}${event.faceCount !== undefined && event.faceCount !== null ? ` · ${event.faceCount} face(s)` : ''}`;
    body.append(title, meta);
    const status = document.createElement('span');
    status.className = `event-state ${event.resolvedAt ? 'resolved' : event.acknowledged ? 'acknowledged' : 'active'}`;
    status.textContent = event.resolvedAt ? 'Resolved' : event.acknowledged ? 'Acknowledged' : 'Active';
    row.append(badge, body, status);
    if (!event.acknowledged && !event.resolvedAt) {
      const button = document.createElement('button');
      button.className = 'button text-button';
      button.textContent = 'Acknowledge';
      button.setAttribute('aria-label', `Acknowledge ${event.description}`);
      button.addEventListener('click', () => {
        event.acknowledged = true;
        persistEventState(event, 'acknowledged');
        renderEvents();
      });
      row.append(button);
    }
    list.append(row);
  });
}

function typeLabel(type) {
  return ({ absence: 'Absence signal', multiple_faces: 'Multiple-face signal', camera: 'Camera issue', detector: 'Detector issue', focus: 'Focus notice', monitoring: 'Monitoring' })[type] || type;
}

function updateElapsed() {
  const seconds = Math.floor((Date.now() - sessionStartedAt) / 1000);
  $('metric-time').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  if (sessionLimitReached(seconds, settings.duration)) stopMonitoring('completed');
}

function stopMonitoring(status = 'completed') {
  if (isStarting) {
    isStarting = false;
    startAttempt += 1;
    cancelAnimationFrame(animationFrame);
    cleanupCamera();
    detector?.close();
    detector = null;
    $('metric-status').textContent = 'Standby';
    $('session-label').textContent = 'No active session';
    $('detector-status').textContent = 'Detector stopped';
    $('model-status').textContent = 'Ready to retry';
    $('engine-state').textContent = 'STANDBY';
    $('live-pill').innerHTML = '<i></i> OFFLINE';
    $('start-monitoring').disabled = false;
    $('start-monitoring').classList.remove('hidden');
    $('stop-monitoring').classList.add('hidden');
    $('switch-camera').disabled = true;
    $('camera-placeholder').classList.remove('hidden');
    $('camera-placeholder-title').textContent = 'Your camera is off';
    $('camera-placeholder-copy').textContent = 'Start monitoring to enable local face detection.';
    $('overlay-detection').textContent = 'DETECTOR IDLE';
    setCameraUi('off');
    return;
  }
  if (!isRunning && !stream) return;
  isRunning = false;
  startAttempt += 1;
  cancelAnimationFrame(animationFrame);
  clearInterval(elapsedTimer);
  monitor?.reset();
  const endedAt = Date.now();
  addEvent({
    type: 'monitoring',
    severity: 'info',
    description: status === 'completed' ? 'Monitoring session stopped.' : 'Monitoring session interrupted.',
    timestamp: endedAt
  });
  const summary = summarizeSession(sessionStartedAt, endedAt, events.slice(0, events.length - sessionAlertStart));
  cleanupCamera();
  $('metric-status').textContent = 'Standby';
  $('face-status').textContent = 'Waiting';
  $('detector-status').textContent = 'Detector stopped';
  $('model-status').textContent = 'Ready to retry';
  $('engine-state').textContent = 'STANDBY';
  $('live-pill').innerHTML = '<i></i> OFFLINE';
  $('session-label').textContent = `Last session · ${summary.durationSeconds}s · ${summary.alertCount} events`;
  $('start-monitoring').classList.remove('hidden');
  $('start-monitoring').disabled = false;
  $('stop-monitoring').classList.add('hidden');
  $('switch-camera').disabled = true;
  $('camera-placeholder').classList.remove('hidden');
  $('camera-placeholder-title').textContent = 'Your camera is off';
  $('camera-placeholder-copy').textContent = 'Start monitoring to enable local face detection.';
  $('overlay-detection').textContent = 'DETECTOR IDLE';
  $('overlay-face-count').textContent = '0 faces';
  $('metric-faces').textContent = '—';
  $('detail-face-count').textContent = '—';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  setCameraUi('off');
  const stoppedSessionId = sessionId;
  sessionId = null;
  if (stoppedSessionId) {
    void safeApi(`/api/sessions/${stoppedSessionId}/stop`, {
      method: 'PATCH', body: JSON.stringify({ durationSeconds: summary.durationSeconds, faceEvents: summary.faceEvents, status })
    }).then(() => refreshSessions());
  } else {
    void refreshSessions();
  }
  detector?.close();
  detector = null;
}

function handlePageExit() {
  if (!isRunning) {
    if (isStarting) startAttempt += 1;
    isStarting = false;
    cleanupCamera();
    detector?.close();
    return;
  }
  const endedAt = Date.now();
  monitor?.reset();
  const exitEvent = {
    type: 'monitoring',
    severity: 'info',
    description: 'Monitoring was interrupted when the page was closed or navigated away.',
    timestamp: endedAt
  };
  events.unshift(exitEvent);
  const summary = summarizeSession(sessionStartedAt, endedAt, events.slice(0, events.length - sessionAlertStart));
  const endingSessionId = sessionId;
  isRunning = false;
  sessionId = null;
  cancelAnimationFrame(animationFrame);
  clearInterval(elapsedTimer);
  cleanupCamera();
  detector?.close();
  detector = null;
  if (endingSessionId) {
    const requests = [
      [`/api/sessions/${endingSessionId}/alerts`, {
        method: 'POST',
        body: JSON.stringify({
          type: exitEvent.type, severity: exitEvent.severity, description: exitEvent.description,
          occurredAt: new Date(endedAt).toISOString()
        })
      }],
      [`/api/sessions/${endingSessionId}/stop`, {
        method: 'PATCH',
        body: JSON.stringify({ durationSeconds: summary.durationSeconds, faceEvents: summary.faceEvents, status: 'interrupted' })
      }]
    ];
    for (const [url, options] of requests) {
      void fetch(url, {
        ...options, keepalive: true, headers: { 'Content-Type': 'application/json' }
      }).catch((error) => console.warn('Could not persist the interrupted session:', error.message));
    }
  }
}

function cleanupCamera() {
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
}

async function switchCamera() {
  if (!stream) return;
  try {
    cameraDevices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
    if (cameraDevices.length < 2) return toast('No additional camera is available.', 'info');
    cameraDeviceIndex = (cameraDeviceIndex + 1) % cameraDevices.length;
    stopMonitoring('interrupted');
    toast(`Camera changed to ${cameraDevices[cameraDeviceIndex].label || `camera ${cameraDeviceIndex + 1}`}. Start a new session to use it.`, 'success');
  } catch (error) {
    showCameraError(`Could not switch cameras: ${error.message}`);
  }
}

function setCameraUi(state) {
  const status = {
    requesting: ['Requesting camera permission', 'Respond to your browser permission prompt', 'amber'],
    active: ['Camera connected', 'Video is being processed locally', 'green'],
    off: ['Camera disconnected', 'Permission is requested only after you choose Start', '']
  }[state];
  $('camera-control-status').textContent = status[0];
  $('camera-control-detail').textContent = status[1];
  $('camera-indicator').className = `status-indicator ${status[2]}`;
  $('camera-status').textContent = state === 'active' ? 'Camera active · local processing' : state === 'requesting' ? 'Waiting for permission' : 'Camera not started';
}

function showCameraError(message) {
  $('camera-error').textContent = message;
  $('camera-error').classList.remove('hidden');
  $('camera-placeholder').classList.remove('hidden');
  $('camera-placeholder-title').textContent = 'Camera or detector unavailable';
  $('camera-placeholder-copy').textContent = message;
}

function clearCameraError() {
  $('camera-error').classList.add('hidden');
  $('camera-error').textContent = '';
}

async function safeApi(url, options = {}) {
  const result = await requestApiJson(fetch, url, {
    ...options, headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  if (!result.available) {
    $('api-dot').classList.remove('online');
    $('api-dot').classList.add('offline');
    $('api-label').textContent = 'Session storage unavailable';
    $('event-footer-copy').textContent = 'Backend or database unavailable. Local monitoring and current-page alerts remain available.';
    return null;
  }
  if (result.error) {
    console.warn('Vision Guard API request failed:', result.error.message);
    return null;
  }
  return result.data;
}

async function refreshSessions() {
  const result = await safeApi('/api/sessions');
  const list = $('session-list');
  if (!list) return;
  list.replaceChildren();
  if (!result?.sessions?.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state compact';
    const title = document.createElement('strong');
    title.textContent = 'No persisted sessions';
    const description = document.createElement('p');
    description.textContent = 'Connect MongoDB to retain operational session metadata.';
    empty.append(title, description);
    list.append(empty);
    return;
  }
  result.sessions.forEach((session) => {
    const row = document.createElement('div');
    row.className = 'session-row';
    const date = document.createElement('span');
    date.textContent = new Date(session.startedAt).toLocaleString();
    const duration = document.createElement('small');
    duration.textContent = `${session.durationSeconds ?? 0}s`;
    const counts = document.createElement('small');
    counts.textContent = `${session.alertCount ?? 0} signals · ${session.faceEvents ?? 0} face events`;
    const status = document.createElement('span');
    status.className = `session-status ${session.status}`;
    status.textContent = session.status;
    row.append(date, duration, counts, status);
    list.append(row);
  });
}

function downloadCsv() {
  const blob = new Blob([`\uFEFF${alertsToCsv(events)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `vision-guard-events-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function clearHistory() {
  if (!confirm('Clear all alert history in this page and permanently delete stored demo sessions? Any active session remains open but its saved alerts are removed.')) return;
  events.splice(0);
  sessionAlertStart = 0;
  renderEvents();
  const response = await safeApi('/api/sessions', { method: 'DELETE' });
  if (response) {
    toast('Alert and stored session history cleared.', 'success');
    void refreshSessions();
  }
  else toast('Current page alert history cleared. Server history could not be reached.', 'info');
}

function openConsent() {
  $('consent-checkbox').checked = false;
  $('consent-continue').disabled = true;
  $('consent-dialog').showModal();
}

function configure() {
  renderSettings();
  $('settings-form').addEventListener('submit', (event) => event.preventDefault());
  $('settings-form').addEventListener('change', saveSettings);
  $('reset-settings').addEventListener('click', () => {
    settings = { ...DEFAULT_SETTINGS };
    let preferencesCleared = true;
    try {
      localStorage.removeItem('visionGuardSettings');
    } catch (error) {
      preferencesCleared = false;
      console.warn('Could not clear saved Vision Guard preferences:', error.message);
    }
    renderSettings();
    toast(
      preferencesCleared ? 'Default monitoring settings restored.' : 'Defaults are active for this page, but saved preferences could not be cleared.',
      preferencesCleared ? 'success' : 'error'
    );
  });
  $('consent-checkbox').addEventListener('change', (event) => { $('consent-continue').disabled = !event.target.checked; });
  $('consent-dialog').addEventListener('close', () => {
    if ($('consent-dialog').returnValue === 'start' && $('consent-checkbox').checked) void startMonitoring();
  });
  $('start-monitoring').addEventListener('click', openConsent);
  $('stop-monitoring').addEventListener('click', () => stopMonitoring('completed'));
  $('switch-camera').addEventListener('click', switchCamera);
  $('filter-type').addEventListener('change', renderEvents);
  $('filter-status').addEventListener('change', renderEvents);
  $('export-csv').addEventListener('click', downloadCsv);
  $('clear-history').addEventListener('click', () => void clearHistory());
  $('refresh-sessions').addEventListener('click', () => void refreshSessions());
  $('privacy-open').addEventListener('click', () => $('privacy-dialog').showModal());
  $('privacy-footer').addEventListener('click', () => $('privacy-dialog').showModal());
  $('notice-dismiss').addEventListener('click', (event) => event.currentTarget.parentElement.remove());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isRunning) monitor?.reset();
    if (!settings.focusEnabled || !isRunning || document.visibilityState !== 'hidden' || Date.now() - lastFocusAlert < settings.cooldown * 1000) return;
    lastFocusAlert = Date.now();
    addEvent({ type: 'focus', severity: 'info', description: 'Browser tab lost focus. This can happen during normal use and is not evidence of misconduct.', timestamp: Date.now() });
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    if ((isRunning || isStarting) && stream?.getTracks().every((track) => track.readyState === 'ended')) {
      addEvent({ type: 'camera', severity: 'error', description: 'Camera disconnected during monitoring.', timestamp: Date.now() });
      stopMonitoring('interrupted');
      showCameraError('The camera disconnected. Reconnect it and start monitoring again.');
    }
  });
  window.addEventListener('pagehide', handlePageExit);
  setInterval(() => { $('overlay-clock').textContent = new Date().toLocaleTimeString(); }, 1000);
  void checkHealth();
  void refreshSessions();
  renderEvents();
}

configure();
