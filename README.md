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

