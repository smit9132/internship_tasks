# TrackWise

TrackWise is a local personal AI assistant for managing expenses, habits, tasks, and productivity summaries. It is designed for local or trusted environments and should not be exposed publicly without authentication and additional hardening.

## Features

- Expense CRUD and analytics
- Habit tracking and streak summaries
- Task management with status filters
- AI assistant using a deterministic fallback parser when Ollama is unavailable
- Dashboard with spending and productivity metrics
- REST API for data management and AI chat interactions

## Quick start

1. Install MongoDB Community Server and make sure its Windows service is running, or configure `MONGODB_URI` for another MongoDB deployment.
2. Copy `.env.example` to `.env`. Its default URI connects to the local MongoDB instance at `127.0.0.1:27017`.
3. Install dependencies:
   `npm install`
4. Start the app:
   `npm start`
5. For development:
   `npm run dev`
6. Check the database connection at `http://localhost:3001/api/status`. The database status should be `connected`.

When `MONGODB_URI` is configured but MongoDB cannot be reached, TrackWise exits with a startup error instead of silently switching to temporary in-memory storage. If `MONGODB_URI` is omitted, it intentionally starts in memory-only mode.

## Environment variables

- PORT: Application port, default 3001
- MONGODB_URI: MongoDB connection string for persistent storage
- OLLAMA_BASE_URL: Local Ollama endpoint, example `http://127.0.0.1:11434`
- OLLAMA_MODEL: Model name to use for local AI requests
- OLLAMA_TIMEOUT_MS: Timeout for Ollama requests

The app assumes local machine timezone for date calculations and displays. All date handling is based on the system timezone of the host machine.

## AI behavior

- If `OLLAMA_BASE_URL` is configured and reachable, the assistant uses Ollama.
- If not, it falls back to deterministic command parsing for supported expense, habit, and task requests.
- The app validates actions on the server and never executes arbitrary shell commands or raw database queries from user input.

## Notes

- The application is intended for local or trusted use only.
- It should not be deployed publicly without authentication, HTTPS, and additional security controls.
- No real credentials or secrets are included in the repository.
