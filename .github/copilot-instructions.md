## AI Financial Advisor — Copilot instructions

Purpose: give an AI coding agent the minimal, actionable knowledge to be productive in this repository.

High-level architecture
- Backend: `server.js` — Express app that implements the public API, session handling and the rule-based allocator. LLM calls (OpenAI) are optional and performed inline in `/api/recommend`.
- Persistence: `db.js` (better-sqlite3) creates `data/app.db`. Recommendations are saved via `storage.js` into the `recommendations` table. Sessions are stored in `data/sessions.sqlite` via `connect-sqlite3`.
- Frontend: SPA static files under `public/` (main entry `public/index.html`, client logic in `public/app.js` and `public/dashboard.js`). `server.js` serves `public/` and falls back to `index.html` for SPA routing.

Key files to read before making changes
- `server.js` — primary place for API behavior, LLM call, ruleBasedAllocation(), and routing.
- `db.js` — DB path (`data/app.db`), migrations run at startup.
- `storage.js` — simple helpers: `saveRecommendation(sessionId, payload, userId)` and `getHistory(sessionId, userId)`; `payload` is stored as JSON string.
- `public/app.js` and `public/dashboard.js` — how the frontend formats requests and expects responses (important when changing API shapes).
- `README.md` and `package.json` — run/dev commands and Node engine constraint.

Important patterns & conventions (project-specific)
- Allocation result shape: { allocations: [{ ticker, weight }], rationale: string, risk_notes: string }. Allocations' weights must sum to 1.0 (server enforces/fixes tiny rounding diffs and biases leftover to `SPY`).
- LLM integration: server will call OpenAI only if `process.env.OPENAI_API_KEY` is set and client posted `useLLM: true`. The server expects the model output to contain a JSON object and tries to extract the first JSON block with a regex before JSON.parse. Do not rely on perfectly formatted LLM output — add robust parsing and validation.
- Fallback behavior: when LLM is unavailable or parsing fails, `ruleBasedAllocation(profile)` (in `server.js`) produces a deterministic allocation — changes to recommendation logic should update both LLM prompts and rule-based fallback if needed.
- Storage: recommendations saved as JSON string in `recommendations.payload`; history endpoints return parsed `payload`. If you change stored shape, update both `storage.js` and the frontend that reads `/api/history`.
- Sessions and auth: lightweight demo auth in `server.js` (`/signup`, `/login`, `/logout`) uses express-session with `connect-sqlite3`. Session id available on `req.session.sid` and saved to `req.sessionId` for linking recommendations.

Run, debug, and quick checks
- Install: `npm install` (project requires Node >=18 per `package.json`)
- Start (production): `npm start` (runs `node server.js`)
- Dev (watch): `npm run dev` (nodemon) — environment variable example: `OPENAI_API_KEY="sk-..." npm run dev`
- Local quick smoke tests (examples):
  - GET universe: `curl -sS http://localhost:3000/api/universe`
  - POST recommend (no LLM):
    curl -sS -X POST http://localhost:3000/api/recommend -H 'Content-Type: application/json' -d '{"risk":3,"horizon":"5-10y","goal":"balanced","useLLM":false}'
  - POST recommend (attempt LLM): include `OPENAI_API_KEY` in env and set `useLLM: true` in body.

Environment variables of interest
- OPENAI_API_KEY — when present enables LLM path in `/api/recommend`.
- SESSION_SECRET — session cookie secret (defaults to 'devsecret' when not set).
- PORT — server listens on `process.env.PORT` (defaults to 3000). Cloud Run example in README uses PORT=8080.
 - DATABASE_URL — when present the app will use Postgres (migrations run at startup) and switch sessions to a Postgres-backed store. Set `DB_SSL=true` if your provider requires SSL.

API surfaces to reference and test
- GET `/api/universe` — returns ETF_UNIVERSE (array of {ticker, class}).
- POST `/api/recommend` — body: profile object (see `public/app.js` FormData mapping). Response: { ok: true, result } where result is the allocation shape above.
- GET `/api/history` — returns saved recommendations (by session or user if logged in).
- POST `/api/scenario` — runs `ruleBasedAllocation` on a modified profile (used by the dashboard scenario button).
- Auth endpoints: `/signup`, `/login`, `/logout` (demo flows; signup inserts into `users` table created by `db.js`).

Deployment notes
- Local dev uses SQLite by default (files under `data/`). For cloud deployments use Postgres and set `DATABASE_URL`. The app will run migrations for Postgres automatically at startup.
- Session storage switches to Postgres when `DATABASE_URL` is set (via `connect-pg-simple`).

Integration gotchas and tests to add when changing behavior
- When changing the allocation shape, update `public/app.js` and `public/dashboard.js` which assume `result.allocations` is an array of {ticker, weight} and that weights are decimals (0-1).
- If LLM prompt or model changes, increase robustness of JSON extraction in `server.js` (server currently extracts the first {...} block and JSON.parse). Validate: allocations exist, weights are numeric and sum to ~1.
- Database/location: `data/app.db` and `data/sessions.sqlite` are created at runtime and commited to `.gitignore` — tests should use temporary DB paths or a mocked `better-sqlite3` instance.

Where to change visuals
- `public/styles.css` — simple static styling.
- Chart and TradingView behavior in `public/app.js` — ticker -> exchange mapping (`exchangeMap`) and multiple exchange fallbacks are implemented there; update mapping if adding ETFs.

If this file already exists, merge notes
- Preserve run instructions and environment notes. Replace outdated model names, port defaults, or file paths only after validating the running server.

If anything here is unclear or you need examples (curl payloads, unit test scaffolding, or a small validation test for LLM JSON), tell me which section to expand and I will iterate.
