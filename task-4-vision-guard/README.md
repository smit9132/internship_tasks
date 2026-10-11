# Vision Guard

Vision Guard is a local-first, browser-based computer-vision monitoring demonstration. It detects visible faces with MediaPipe, displays bounding boxes and confidence estimates, applies configurable absence/multiple-face rules, and presents a timestamped event feed. It does not identify people, establish intent, or prove misconduct.

## Features and limitations

- Explicit consent before the browser camera prompt; no automatic camera start.
- MediaPipe Face Detector inference in the browser. Camera frames are not uploaded or recorded.
- Face count, confidence-filtered boxes, camera/detector status, session timer and configurable monitoring signals.
- Cooldown-protected absence and multiple-face events, with state-based resolution.
- Session time limit configurable in seconds (1–86,400 seconds); existing saved minute-based settings are migrated to seconds.
- Acknowledgment, filters, CSV export, clear-history confirmation and optional focus-change notices.
- Responsive dashboard and accessible labels/status text.
- Optional Express/Mongoose persistence for session times, aggregate counts and alert metadata only. Live monitoring does not require MongoDB.
- No accounts or authentication: this is a local demonstration, not a private multi-user service. Restrict any public deployment behind suitable access controls.
- Detection accuracy and real-world proctoring performance have not been measured. Detection can fail due to lighting, camera position, occlusion, model limitations or network access.

## Architecture

```text
public/index.html              Dashboard, consent, settings, event history
public/css/styles.css          Responsive dark dashboard
public/js/app.js               Webcam, MediaPipe inference, UI, local session state
public/js/monitoring.js        Testable rules, settings validation, summaries, CSV
src/validation.js              Whitelisted API input validation
src/models.js                  Mongoose session and alert metadata schemas
server.js                      Express API, static hosting, health and MongoDB connection
render.yaml                    Render web-service deployment blueprint
tests/monitoring.test.js        Node built-in test suite
```

## Requirements and installation

- Node.js 20 or newer and npm.
- Optional: MongoDB (local or a reachable MongoDB deployment).
- A modern browser with `getUserMedia`; camera access requires `localhost` or HTTPS.

```sh
cd task-4-vision-guard
npm install
Copy-Item .env.example .env
npm start
```

Open <http://localhost:3000>. `npm run dev` starts Node's watch mode. The `.env` file is optional; if MongoDB is not configured or is unavailable, the browser app remains usable and the dashboard reports that persistence is unavailable.

### Environment

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP port | `3000` |
| `MONGODB_URI` | Optional MongoDB connection string | No persistence when omitted |
| `NODE_ENV` | Runtime environment | Development |

Do not put a real `.env` or credentials in source control.

## Face-detection model and assets

The browser dynamically imports [`@mediapipe/tasks-vision` 0.10.21](https://www.npmjs.com/package/@mediapipe/tasks-vision/v/0.10.21) from jsDelivr and loads `blaze_face_short_range.tflite` from Google's [MediaPipe model storage](https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite). It uses the documented [`FilesetResolver.forVisionTasks` and `FaceDetector.createFromOptions` video API](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector/web_js). The npm package declares Apache-2.0; see the [upstream MediaPipe license](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE). The app does not redistribute the model file; review Google's model documentation and any model-specific terms before redistributing it. These assets are fetched at runtime, so this configuration is **not offline**. The CDN and model host receive ordinary network requests, but no image/video frames are sent to them. To serve assets locally, vendor the same pinned runtime WASM/JS and model files under a documented local asset path and update the URLs in `public/js/app.js`.

When assets cannot load, verify internet/CDN access, allow the model host, and reload/retry monitoring. The app reports detector initialization/inference errors separately from camera errors; a detector failure is not treated as a face-absence event.

## Privacy and data retention

- Camera permission is requested by the browser after the user checks the consent acknowledgment and selects **Continue to camera**.
- Images are used for in-browser detection only. They are not uploaded, stored, streamed to this server, or recorded.
- The model and runtime are downloaded from public CDN/model hosts. These services may see ordinary connection metadata, not camera frames.
- Preferences are stored in browser `localStorage`. Alert feed entries persist only for the current page session.
- When MongoDB is enabled, the API stores session start/end times, duration, face-event counts, alert counts and alert metadata (type, severity, description, timestamps, count/resolution state). It does not store frames, video, embeddings, names or biometric identifiers.
- Stored demo sessions and alerts have no automatic expiration; use **Clear history** to delete server metadata. There is no authentication, user ownership or multi-tenant isolation.
- Stop monitoring ends the active media tracks. Closing/navigating away also stops tracks.
- Monitoring signals need human interpretation and must not be used as automatic penalties.

## API

- `GET /api/health` — app and MongoDB availability.
- `GET /api/sessions` — newest 20 sessions (requires MongoDB).
- `POST /api/sessions` — create session from a recent `startedAt` timestamp.
- `POST /api/sessions/:id/alerts` — store a whitelisted alert.
- `PATCH /api/sessions/:id/alerts/:alertId` — acknowledge or resolve a stored alert.
- `PATCH /api/sessions/:id/alerts/:alertId` — acknowledge or resolve a stored alert.
- `PATCH /api/sessions/:id/stop` — store duration, event count and completion status.
- `DELETE /api/sessions` — clear stored completed sessions and alert events while retaining any active session. Requires MongoDB.

Requests have a 32 KB JSON body limit, Helmet security headers/CSP and an API rate limit. API routes validate fields and use strict Mongoose schemas. There is no authentication; do not expose a public instance without adding access control, HTTPS, origin protections and operational safeguards.

## Tests and checks

```sh
npm test
npm run check
```

The suite covers timers, condition resolution, cooldown/duplicate suppression, settings validation, session summaries, CSV escaping, API input validation and behavior when optional persistence is unavailable.

## Camera and secure contexts

Camera access generally requires HTTPS on deployed sites; browser-recognized secure contexts such as `localhost` are exempt. An ordinary deployed HTTP page cannot use `getUserMedia`. Permission denial can be reversed in browser site settings. If there is no camera, another app is using it, or the browser is unsupported, the dashboard provides a corresponding message. Use a current Chrome, Edge, Firefox or Safari release and allow camera access.

## Deployment

The server listens on `PORT` (default 3000) and serves `public/`. A Render blueprint is included in `render.yaml`; deploy Node.js 20+ behind Render's HTTPS endpoint and configure a MongoDB URI only if persistence is required. Set `NODE_ENV=production`, keep secrets in the host's secret manager, and set `APP_ALLOWED_IPS` to a comma-separated list of trusted client IP addresses. In production, requests other than the minimal health check are denied until this network allowlist is configured and are then limited to those IPs. This is a network restriction, not authentication or user authorization; the demo still has no accounts, so do not publicly expose stored session data or the session-delete API. No deployment has been performed or tested as part of this repository change.

## Manual demo checklist

1. Open the app on localhost, verify the camera is off, and inspect the privacy notice.
2. Start monitoring, confirm the consent dialog, then allow camera access.
3. Verify that one face produces one detection box and visible count; move away and return.
4. With the default 10-second absence delay, wait beyond the threshold, confirm a single warning, then return and check that it resolves.
5. Show an additional face longer than the configured multiple-face delay and check its alert/resolution.
6. Try browser permission denial, a device with no camera, and model/CDN failure; check neutral technical errors and ensure failed detection does not count as absence.
7. Stop and verify the camera indicator goes offline; optionally inspect browser camera activity and network requests to confirm frames are not uploaded.
8. Try event filters, acknowledgment, CSV export, settings validation/reset, and clear-history confirmation.
9. With MongoDB configured, check session persistence and health status; with it stopped/unconfigured, check the local detector still works and persistence is marked unavailable.

## Demo workflow and screenshots

Start with `npm start`, load the dashboard, open the privacy notice, and explain local frame processing. Run the camera consent flow, show a face box, demonstrate a delayed absence signal and return/resolution, then stop. Optional screenshots can be taken from the browser after the model is ready; avoid including private surroundings or bystanders without their permission. No screenshots or camera content are bundled.

## Troubleshooting

- **Camera unsupported/blocked:** use HTTPS or localhost and a modern browser; check browser permissions.
- **No camera / busy:** connect a camera or close other apps using it.
- **Model initialization unavailable:** check network access to jsDelivr and Google model storage; the configured model is fetched from those hosts and is not bundled.
- **No face detected:** confirm lighting, keep the face visible and centered, and adjust the minimum confidence threshold. This is a best-effort detector, not a validated exam-security measure.
- **Session storage unavailable:** check `GET /api/health`, MongoDB URI/connectivity and server logs. In-memory browser monitoring continues.
- **Port in use:** set another `PORT` in `.env`.
