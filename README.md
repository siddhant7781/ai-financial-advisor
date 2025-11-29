# AI Financial Advisor — Prototype

This repository contains a minimal full-stack prototype for the **AI-Powered Investment Recommender** described in the progress report.  

It includes:
- a static frontend (questionnaire) in `public/`
- an Express backend (`server.js`) that integrates with **OpenAI** to generate ETF allocations (with a rule-based fallback if no key is set)

⚠️ **Disclaimer**: This is for educational demonstration only. It is **not financial advice**.

---

## How to Run

1. Install Node.js (>=18). From the project root, run:

```bash
npm install
npm start
```

2. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Environment Variables (dotenv / OpenAI key)

1. Copy `.env.example` to `.env` and set your OpenAI key:

```bash
cp .env.example .env
# edit .env and set OPENAI_API_KEY=sk-your-key-here
```

2. Start the app.  
   - If `OPENAI_API_KEY` is set, the recommender will **always use OpenAI** to generate allocations.  
   - If no key is set, the app will fall back to the built-in **rule-based allocation**.

One-line start without `.env`:

```bash
OPENAI_API_KEY="sk-your-key-here" npm start
```

---

## Files

- `server.js` — Express server with endpoints:
  - `/api/universe` → returns the ETF universe  
  - `/api/recommend` → generates allocations using OpenAI (or rule-based fallback)
- `public/index.html`, `public/app.js`, `public/styles.css` — frontend questionnaire and results display
- `package.json` — scripts and dependencies

---

## Deploying to Google Cloud Run

You can run this app on Google Cloud Run (the example site you linked is a Cloud Run app). Basic steps:

1) Build and push an image (replace <PROJECT_ID> and <REGION>):

```bash
docker build -t gcr.io/<PROJECT_ID>/ai-financial-advisor:latest .
docker push gcr.io/<PROJECT_ID>/ai-financial-advisor:latest
```

2) Deploy to Cloud Run:

```bash
gcloud run deploy ai-financial-advisor \
  --image gcr.io/<PROJECT_ID>/ai-financial-advisor:latest \
  --region <REGION> --platform managed --allow-unauthenticated --port 8080
```

3) Set `OPENAI_API_KEY` securely:
- Quick (not recommended for production):

```bash
gcloud run services update ai-financial-advisor --region <REGION> --set-env-vars OPENAI_API_KEY="sk-REPLACE"
```

- Better: use Secret Manager and expose the secret to Cloud Run:

```bash
# create secret
echo -n "sk-REPLACE" | gcloud secrets create openai-key --data-file=-
# grant Cloud Run the access role
gcloud secrets add-iam-policy-binding openai-key \
  --member="serviceAccount:$(gcloud run services describe ai-financial-advisor --region <REGION> --format='value(status.serviceAccount)')" \
  --role="roles/secretmanager.secretAccessor"
# deploy with secret mounted as an env var
gcloud run deploy ai-financial-advisor --region <REGION> --set-secrets OPENAI_API_KEY=openai-key:latest
```

Notes:
- Cloud Run sets the `PORT` environment variable (default 8080); `server.js` respects `process.env.PORT`.
- Do not commit secrets. `.env` and `.dockerignore` exclude the `.env` file.

## Deployment preparations (Heroku / Azure / other cloud)

This project runs locally with SQLite by default, but for production you should run with Postgres.

- Set `DATABASE_URL` (Postgres connection string). When `DATABASE_URL` is present the server will:
  - use Postgres for `users` and `recommendations` tables (migrations applied at startup)
  - switch session storage to a Postgres-backed store (via `connect-pg-simple`)

- Recommended env vars:
  - `DATABASE_URL` — Postgres connection string (required for production)
  - `OPENAI_API_KEY` — enables LLM path for `/api/recommend`
  - `SESSION_SECRET` — set to a strong secret in production
  - `DB_SSL=true` — set to `true` on some managed Postgres providers if SSL is required

- Note about persistence: the local SQLite files (`data/app.db`, `data/sessions.sqlite`) are for demos only and will not persist reliably on ephemeral hosting (e.g., Heroku dynos). Use Postgres in production.

Quick Heroku example:

```bash
heroku addons:create heroku-postgresql:hobby-dev
heroku config:set SESSION_SECRET="replace-with-strong-secret"
heroku config:set DB_SSL=true
git push heroku master

# Ensure migrations run by restarting the app
heroku restart
```

After deployment, open the app and use the demo signup/login to create a user and verify recommendations persist in the dashboard history.

## Enhanced AI integration (market context & scenarios)

This prototype includes a lightweight `marketdata.js` helper that fetches public quotes (VIX, IEF, SPY, QQQ, VEA, VWO, BND, VNQ, GLD) from Yahoo Finance to build a short market summary. The server includes this summary in LLM prompts when `useLLM=true`.

- `/api/recommend` — when `useLLM` is true and `OPENAI_API_KEY` is set the LLM prompt now includes the latest market summary (VIX and key ETF snapshots) to help the model provide context-aware rationale.
- `/api/scenario` — accepts a `scenario` object (e.g., `{ type: 'rate-rise' }`) and returns both the rule-based `result` and `llm_result` (if LLM path was used). Example response:

  {
    "ok": true,
    "profile": {...},
    "result": { ... },
    "llm_result": { allocations: [...], rationale: "...", risk_notes: "..." }
  }

This is still a best-effort integration — the LLM path may fail or return non-JSON; the server falls back to the rule-based allocation when needed.

---

## Demo walkthrough (quick)

1. Start the server locally:

```bash
npm install
OPENAI_API_KEY="sk-..." npm start
```

2. Open `http://localhost:3000`.
3. (Optional) Sign up (`/signup`) and log in (`/login`) using the demo form on the site. When logged in, your recommendations will be saved to the SQLite database and shown in the dashboard history.
4. Use the questionnaire, check "Use LLM" if you have an OpenAI key, click Get Recommendation, and view the interactive pie + TradingView chart.

## Deploying to Heroku

1. Create a Heroku app and provision any required add-ons (none required for SQLite local file; consider Heroku Postgres for production):

```bash
heroku create my-ai-financial-advisor
```

2. Set secrets on Heroku:

```bash
heroku config:set OPENAI_API_KEY="sk-..."
heroku config:set SESSION_SECRET="replace-with-strong-secret"
```

3. Push and deploy:

```bash
git push heroku master
heroku open
```

Notes: Heroku ephemeral filesystem means SQLite will not persist across dyno restarts. For production, use Postgres (and switch `db.js` to use `pg`). The current SQLite approach is suitable for local demos and short-lived deployments.


