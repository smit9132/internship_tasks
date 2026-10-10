# EventSync — Event Management System

EventSync is a responsive, full-stack event platform for discovering gatherings, publishing and managing events, registering attendees, and moderating a multi-user community.

## Features

- Public discovery with text search, categories, date filtering, sorting, and pagination.
- Account registration, login/logout, editable profile, secure password hashing, and persistent server-side sessions.
- Attendee dashboard with upcoming events, history, confirmed/cancelled status, and eligible cancellation.
- Organizer dashboard with event counts, actual seven-day registration activity, event CRUD/editing, publication and cancellation, attendee lists, and CSV export.
- Admin workspace for role changes, account deactivation, platform counts, and event moderation.
- Server-side validation and live role/ownership checks; roles cannot be chosen during registration.
- Atomic conditional capacity reservation, unique user/event registration records, and capacity release on cancellation.
- Online meeting links are not returned to public discovery or event visitors; they are shown only to the organizer or a confirmed attendee.
- Helmet, same-origin/allowlisted CORS, CSRF tokens, HTTP-only SameSite session cookies, login rate limiting, JSON size limits, and safe error messages.
- Paid event reservations are explicitly marked as requiring payment directly with the organizer. EventSync does not process or claim payment; no email is sent.

## Technology

| Layer | Technology |
| --- | --- |
| UI | HTML5, CSS3, vanilla JavaScript |
| Server | Node.js, Express |
| Database | MongoDB, Mongoose |
| Authentication | `express-session`, Mongo-backed sessions, `bcryptjs` |
| Security | Helmet, CORS allowlist, CSRF request token, rate limiting |
| Tests | Node.js test runner, Supertest, isolated `mongodb-memory-server` |

## Project layout

```text
task-3-eventsync/
├── config/database.js
├── middleware/auth.js
├── models/{User,Event,Registration}.js
├── public/
│   ├── css/styles.css
│   ├── js/{api,discover,event,dashboard,admin}.js
│   ├── index.html
│   ├── event.html
│   ├── dashboard.html
│   └── admin.html
├── routes/{auth,events,dashboard,admin}.js
├── scripts/create-admin.js
├── services/registrationService.js
├── tests/eventsync.test.js
├── utils/{errors,validation}.js
├── .env.example
├── package.json
└── server.js
```

## Requirements and local setup

- Node.js 20 or newer and npm.
- A reachable MongoDB deployment: local MongoDB Community Server or MongoDB Atlas.
- For a local MongoDB install, start the MongoDB service and use its local URI. For Atlas, create a database user, allow the app host in Network Access, and copy the SRV connection URI. Never put database credentials in source control.

From the repository root:

```powershell
Set-Location .\task-3-eventsync
Copy-Item .env.example .env
npm install
```

Edit `.env` and set:

```dotenv
PORT=3000
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/eventsync
SESSION_SECRET=<at-least-32-random-characters>
CORS_ORIGINS=
TRUST_PROXY=0
```

Generate a suitable session secret locally (do not use the example value in production):

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

`CORS_ORIGINS` is optional. By default only same-origin requests are allowed. For a separately hosted UI, set a comma-separated exact-origin allowlist, such as `https://events.example.com`; do not use `*` with cookies.

## Start and test

```powershell
npm run dev
```

Open <http://localhost:3000>. For the normal production-style process, use `npm start`.

Run tests:

```powershell
npm test
```

Tests start a separate ephemeral MongoDB instance and use a separate test database. They do not connect to or delete the configured application database. The first test run may download a MongoDB test binary; ensure the environment can download that dependency. Automated tests cover registration validation, password hashing, session/CSRF auth, role authorization, event creation and ownership, publication visibility, dates/capacity, concurrent and duplicate registrations, closing time, cancellation/capacity release, attendee privacy, organizer access, admin-only operations, moderation, deactivation, and safe invalid requests.

Dependency review:

```powershell
npm audit
```

Review audit findings against the exact dependency tree and advisories before applying updates. Do not run `npm audit fix --force` blindly.

## Safe initial administrator setup

Public sign-up always creates an attendee. It does not accept or honor a requested role.

Create the first administrator from an interactive terminal after MongoDB and `.env` are ready:

```powershell
npm run admin:create -- admin@example.com
```

The script asks for a display name and password without echoing the password, refuses to replace an existing account, and creates only the administrator specified by that command. Keep the resulting credentials private, and use the admin interface to grant the organizer role to trusted event hosts. Do not expose this one-time setup command as a public HTTP endpoint.

## Demo walkthrough

1. **Attendee:** create an account from the home page; browse and search; open an event; register; inspect **My events**; cancel an eligible registration and confirm the event's available capacity increases.
2. **Organizer:** an administrator changes a test attendee's role to Organizer. Log in as that user; create a draft, publish it, inspect the registration activity, open attendee details, export the CSV, edit the event, and cancel it.
3. **Admin:** run the safe bootstrap command to create an admin (or log in with an existing admin). Open **Admin**; search users, update roles, deactivate/reactivate a test account, and moderate an event.
4. Visit `/api/health` to check application and MongoDB status. It returns HTTP 503 if the database is not connected.

Use separate browser profiles or private windows to demonstrate the different account roles without confusing session cookies.

## REST API

All JSON request bodies use `Content-Type: application/json`. Cookies are session-based. Before any state-changing request, obtain a session CSRF token:

```http
GET /api/auth/csrf
```

Send the returned token in `X-CSRF-Token` for `POST`, `PATCH`, and `DELETE`. The browser client does this automatically.

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /api/health` | Public | App/database readiness |
| `GET /api/auth/csrf` | Public | Establish session and obtain CSRF token |
| `POST /api/auth/register` | Public | Create attendee account |
| `POST /api/auth/login` | Public | Sign in |
| `POST /api/auth/logout` | Signed in | End session |
| `GET /api/auth/me` | Signed in | Current profile |
| `PATCH /api/auth/me` | Signed in | Edit name/email |
| `GET /api/events?q=&category=&from=&to=&sort=&page=&limit=` | Public | Search published future events |
| `GET /api/events/:eventId` | Public | Event details; online join link is private |
| `POST /api/events/:eventId/register` | Attendee | Reserve a place; paid events are marked for offline payment with the organizer |
| `GET /api/events/mine/registrations` | Signed in | Private registration history |
| `DELETE /api/events/registrations/:registrationId` | Owner | Cancel eligible registration and release a place |
| `GET /api/dashboard/attendee` | Signed in | Attendee dashboard data |
| `GET /api/dashboard/organizer` | Organizer/admin | Owned-event counts and actual registration trends |
| `GET /api/events/organizer/mine` | Organizer/admin | Organizer-owned event list |
| `POST /api/events` | Organizer/admin | Create a draft (owner is assigned on server) |
| `PATCH /api/events/:eventId` | Owner/admin | Edit event fields |
| `POST /api/events/:eventId/publish` | Owner/admin | Publish a valid draft |
| `POST /api/events/:eventId/cancel` | Owner/admin | Cancel an event |
| `POST /api/events/:eventId/complete` | Owner/admin | Mark an ended published event completed |
| `GET /api/events/:eventId/registrations` | Owner/admin | View confirmed attendee details |
| `GET /api/events/:eventId/registrations.csv` | Owner/admin | Download attendee CSV |
| `GET /api/admin/stats` | Admin | User, event, and booking counts |
| `GET /api/admin/users?q=&page=&limit=` | Admin | Search accounts; each user includes account creation date and confirmed/total event registration counts |
| `PATCH /api/admin/users/:userId` | Admin | Change a role or account activation |
| `GET /api/admin/events` | Admin | List events for moderation |
| `PATCH /api/admin/events/:eventId` | Admin | Set `published`, `cancelled`, or `completed` |

Example login:

```json
{
  "email": "attendee@example.com",
  "password": "a-long-private-password"
}
```

Example event creation (all timestamps are ISO-8601):

```json
{
  "title": "A thoughtful community gathering",
  "description": "Come meet good people and make a little more room for creativity.",
  "category": "Community",
  "venue": { "type": "in-person", "name": "The Greenhouse", "address": "12 Garden Lane" },
  "startAt": "2027-04-18T18:00:00.000Z",
  "endAt": "2027-04-18T20:00:00.000Z",
  "registrationOpensAt": "2027-04-01T00:00:00.000Z",
  "registrationClosesAt": "2027-04-18T17:00:00.000Z",
  "timezone": "Asia/Kolkata",
  "capacity": 40,
  "ticketPrice": 0,
  "currency": "INR"
}
```

The Admin **People & roles** table shows each account's name, email, creation date, confirmed registration count, and total count including cancellations. Expand **View registered events** in a row to see each event title, category, date, registration status, and offline-payment note where applicable. Use its search and pagination controls to find accounts.

Errors have a safe `{ "error": "..." }` response; field-validation errors may also include a `details` array. Typical codes are 400 invalid input, 401 unauthenticated, 403 insufficient permission/CSRF, 404 not found (including resources outside the caller's ownership), 409 conflict/full/duplicate/closed, and 500 generic server failure.

## Data and concurrency notes

- MongoDB is the only application database. Models define timestamps, enum/field validation, indexes, and references.
- A unique `{ user, event }` index prevents duplicate registrations, including concurrent duplicates.
- Registration reserves a space using one conditional `findOneAndUpdate` on the event document (`registeredCount < capacity`, published status, and open date window). A failed registration write compensates that reservation; cancellation first changes a single confirmed registration and then decrements the cached count. This avoids overbooking without requiring a MongoDB replica-set transaction.
- The connection must be private/reliable in production. If the process is forcibly terminated between a seat reservation and registration write, reconcile counts operationally; a replica-set transaction is an alternative if a deployment requires stronger crash atomicity.
- Online meeting URLs are disclosed only to confirmed attendees and the event organizer. Attendee emails are visible only to the managing organizer and administrators.
- Free registrations do not depend on any payment service. Paid events reserve a place with `paymentStatus: offline-payment-required`; the attendee is given the organizer's email address and amount to arrange payment directly. EventSync does not collect, verify, or claim payment, and cancellations do not imply a refund. Configure and verify a real payment provider before representing these reservations as paid online.

## Deployment

1. Provision MongoDB (Atlas or another managed MongoDB host), create a least-privilege app database user, and restrict allowed network sources.
2. Deploy this directory to a Node.js hosting platform. Configure `npm install` as the build/install step and `npm start` as the start command.
3. Set `NODE_ENV=production`, `MONGODB_URI`, a strong unique `SESSION_SECRET`, and `PORT` as platform environment variables. Set `TRUST_PROXY=1` only when the host's trusted HTTPS reverse proxy is configured. Add only necessary exact UI origins to `CORS_ORIGINS`.
4. Serve the application over HTTPS. Production cookies are `Secure`, `HttpOnly`, and `SameSite=Lax`; do not terminate HTTPS before the trusted proxy without configuring it correctly.
5. Run the admin bootstrap command from a secure interactive deployment shell. Do not bake credentials into the image or source tree.
6. Verify `https://<your-host>/api/health`, sign in, and exercise a test event lifecycle before inviting users.

No deployment has been performed from this workspace. Do not use the development `.env.example` secret or open database access to the public internet.

## Screenshots

No screenshots are included because the application has not been run against a configured MongoDB instance here. To make genuine screenshots after setup, start the app, open it in a browser at desktop and mobile widths, sign in using demo accounts, and capture the actual discovery, event detail, attendee, organizer, and admin pages. Do not include real attendee email addresses in shared screenshots.

## Troubleshooting

- **`MONGODB_URI is required` / startup error:** create a local `.env` from `.env.example`, set a valid URI, and start the MongoDB service or check Atlas network access and database credentials.
- **Health check returns 503:** confirm MongoDB is reachable using the same configured URI; server startup intentionally fails if it cannot connect.
- **Browser reports a CORS error:** same-origin deployment needs no allowlist. For cross-origin hosting, add the exact scheme/host/port to `CORS_ORIGINS`; cookie credentials cannot use wildcard origins.
- **Mutation returns 403 security token:** reload the page so it obtains a fresh CSRF token and session cookie. Keep browser cookies enabled.
- **Production login loops:** verify HTTPS is active end-to-end and `TRUST_PROXY=1` is set only behind the platform's trusted proxy.
- **Admin setup says account exists:** the bootstrap script never overwrites users. Sign in with a current administrator and update roles in the Admin workspace.
- **Test Mongo binary download fails:** permit the test runner to download the `mongodb-memory-server` binary, then run `npm test` again. These tests do not use the configured app database.
