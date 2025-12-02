require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// session and auth
const session = require('express-session');
const db = require('./db');

let sessionStore = null;
if (process.env.DATABASE_URL) {
  // use Postgres-backed session store
  const PgStore = require('connect-pg-simple')(session);
  sessionStore = new PgStore({ pool: db.pool, tableName: 'session' });
} else {
  const SQLiteStore = require('connect-sqlite3')(session);
  sessionStore = new SQLiteStore({ db: 'sessions.sqlite', dir: './data' });
}

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'devsecret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// helper: attach sessionId and userId
app.use((req, res, next) => {
  if (!req.session.sid) req.session.sid = require('uuid').v4();
  req.sessionId = req.session.sid;
  req.userId = req.session.userId || null;
  next();
});

// API Routes
app.use('/', require('./routes/api'));

// Serve static frontend (placed after API endpoints)
app.use('/', express.static(path.join(__dirname, 'public')));

// Fallback for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`AI Financial Advisor prototype running at http://localhost:${PORT}`);
  if (!process.env.OPENAI_API_KEY) console.log('OPENAI_API_KEY not set — LLM calls will be skipped.');
});