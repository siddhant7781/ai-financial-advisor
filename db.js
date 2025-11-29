const path = require('path');
const fs = require('fs');

// Support either local SQLite (default) or PostgreSQL via DATABASE_URL
if (process.env.DATABASE_URL) {
  // Use Postgres
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false });

  // Run simple migrations for Postgres
  const migrations = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recommendations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  session_id TEXT,
  payload TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
`;

  (async () => {
    try {
      await pool.query(migrations);
      console.log('Postgres migrations applied');
    } catch (e) {
      console.error('Postgres migration error', e.message);
    }
  })();

  module.exports = {
    type: 'pg',
    pool,
    query: (text, params) => pool.query(text, params)
  };

} else {
  // Default to SQLite for local dev/demo
  const Database = require('better-sqlite3');
  const DB_PATH = path.join(__dirname, 'data', 'app.db');

  function ensureDir() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  ensureDir();

  const db = new Database(DB_PATH);

  // migrations
  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  session_id TEXT,
  payload TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

  module.exports = { type: 'sqlite', db };
}
