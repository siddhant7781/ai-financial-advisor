const dbMod = require('./db');

// Normalize to async functions so callers (server.js) can await storage operations no matter the backend
async function saveRecommendation(sessionId, payload, userId = null) {
  const json = JSON.stringify(payload);
  if (dbMod.type === 'pg') {
    await dbMod.query('INSERT INTO recommendations (user_id, session_id, payload) VALUES ($1, $2, $3)', [userId, sessionId, json]);
    return;
  }
  // sqlite (synchronous)
  const stmt = dbMod.db.prepare('INSERT INTO recommendations (user_id, session_id, payload) VALUES (?, ?, ?)');
  stmt.run(userId, sessionId, json);
}

async function getHistory(sessionId, userId = null) {
  if (dbMod.type === 'pg') {
    if (userId) {
      const r = await dbMod.query('SELECT id, payload, created_at FROM recommendations WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
      return r.rows.map(row => ({ id: row.id, ts: row.created_at, payload: JSON.parse(row.payload) }));
    }
    const r = await dbMod.query('SELECT id, payload, created_at FROM recommendations WHERE session_id = $1 ORDER BY created_at DESC', [sessionId]);
    return r.rows.map(row => ({ id: row.id, ts: row.created_at, payload: JSON.parse(row.payload) }));
  }

  // sqlite
  if (userId) {
    const stmt = dbMod.db.prepare('SELECT id, payload, created_at FROM recommendations WHERE user_id = ? ORDER BY created_at DESC');
    return stmt.all(userId).map(r => ({ id: r.id, ts: r.created_at, payload: JSON.parse(r.payload) }));
  }
  const stmt = dbMod.db.prepare('SELECT id, payload, created_at FROM recommendations WHERE session_id = ? ORDER BY created_at DESC');
  return stmt.all(sessionId).map(r => ({ id: r.id, ts: r.created_at, payload: JSON.parse(r.payload) }));
}

module.exports = { saveRecommendation, getHistory };
