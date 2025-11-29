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
const bcrypt = require('bcrypt');
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

// Serve static frontend (moved to after API routes to ensure API endpoints are matched first)

// Load universe (hard-coded for prototype)
const ETF_UNIVERSE = [
  { ticker: 'SPY', class: 'US Equity (Large)' },
  { ticker: 'IJR', class: 'US Equity (Small)' },
  { ticker: 'VTV', class: 'US Equity (Value)' },
  { ticker: 'QQQ', class: 'US Equity (Growth)' },
  { ticker: 'VEA', class: 'Intl Equity (Dev)' },
  { ticker: 'VWO', class: 'Intl Equity (EM)' },
  { ticker: 'BND', class: 'Bonds (Aggregate)' },
  { ticker: 'IEF', class: 'Bonds (7-10yr Treasury)' },
  { ticker: 'TIP', class: 'Bonds (TIPS)' },
  { ticker: 'SHY', class: 'Bonds (1-3yr Treasury)' },
  { ticker: 'VNQ', class: 'Real Estate (REITs)' },
  { ticker: 'GLD', class: 'Commodities (Gold)' },
  { ticker: 'DBC', class: 'Commodities (Broad)' },
  { ticker: 'BIL', class: 'Cash Proxy (T-Bills)' },
  { ticker: 'AGG', class: 'Bonds (Aggregate alt)' }
];

// Helper: simple rule-based allocation
function ruleBasedAllocation(profile) {
  // profile: {risk:1-5, horizon, goal, constraints:[]}
  const risk = Number(profile.risk) || 3;
  const horizon = profile.horizon || '5-10y';
  const goal = profile.goal || 'balanced';
  const constraints = profile.constraints || [];

  // Base equity/bond targets from mapping
  const horizon_map = {
    '<2y': { equity_max: 0.5, bonds_min: 0.4 },
    '2-5y': { equity_max: 0.65, bonds_min: 0.25 },
    '5-10y': { equity_max: 0.8, bonds_min: 0.15 },
    '10y+': { equity_max: 0.9, bonds_min: 0.1 }
  };
  const goal_bias = {
    growth: { equity_min: 0.6 },
    income: { bonds_min: 0.4, reits_min: 0.05 },
    balanced: { equity_min: 0.5, bonds_min: 0.25 }
  };

  const h = horizon_map[horizon] || horizon_map['5-10y'];
  const g = goal_bias[goal] || goal_bias['balanced'];

  // risk influences equity share
  const risk_equity_scale = {1:0.2,2:0.35,3:0.55,4:0.7,5:0.85};
  let equity_target = risk_equity_scale[risk] || 0.55;
  equity_target = Math.min(equity_target, h.equity_max || 0.9);
  equity_target = Math.max(equity_target, g.equity_min || 0);

  let bonds_target = 1 - equity_target;
  if (g.bonds_min) bonds_target = Math.max(bonds_target, g.bonds_min);
  if (h.bonds_min) bonds_target = Math.max(bonds_target, h.bonds_min);

  // Build allocations with simple ETF choices
  const alloc = {};

  // handle constraints: e.g., avoid EM, avoid REITs, avoid commodities
  const avoidEM = constraints.includes('Avoid EM');
  const avoidREIT = constraints.includes('Avoid REITs');
  const avoidComm = constraints.includes('Avoid commodities');

  // Equity split: US core (SPY), US small (IJR), Intl dev (VEA), EM (VWO), Growth (QQQ), Value (VTV)
  const equity_buckets = [
    {ticker:'SPY', weight:0.45},
    {ticker:'IJR', weight:0.1},
    {ticker:'VEA', weight:0.15},
    {ticker:'VWO', weight:0.05},
    {ticker:'QQQ', weight:0.15},
    {ticker:'VTV', weight:0.1}
  ];

  // Remove EM if asked
  if (avoidEM) {
    for (const b of equity_buckets) if (b.ticker === 'VWO') b.weight = 0;
  }

  // Normalize equity bucket weights >0
  let eq_total = equity_buckets.reduce((s,b)=>s+(b.weight||0),0);
  equity_buckets.forEach(b=>{ if(b.weight) alloc[b.ticker] = (b.weight/eq_total)*equity_target; });

  // Bond buckets: BND, AGG, IEF, TIP, SHY
  const bond_buckets = [
    {ticker:'BND', weight:0.6},
    {ticker:'AGG', weight:0.2},
    {ticker:'IEF', weight:0.1},
    {ticker:'TIP', weight:0.05},
    {ticker:'SHY', weight:0.05}
  ];
  let bond_total = bond_buckets.reduce((s,b)=>s+b.weight,0);
  bond_buckets.forEach(b=> alloc[b.ticker] = (b.weight/bond_total)*bonds_target);

  // Small allocations: REITs and commodities if not avoided
  if (!avoidREIT) alloc['VNQ'] = 0.03;
  if (!avoidComm) {
    alloc['GLD'] = 0.02;
    alloc['DBC'] = 0.02;
  }

  // Cash parking
  alloc['BIL'] = 0.02;

  // Final normalization to sum to 1
  const total = Object.values(alloc).reduce((s,w)=>s+(w||0),0) || 1;
  for (const k of Object.keys(alloc)) alloc[k] = Number((alloc[k]/total).toFixed(4));

  // Ensure weights sum to 1. Adjust tiny rounding diffs to SPY
  let sum = Object.values(alloc).reduce((s,w)=>s+w,0);
  sum = Number(sum.toFixed(6));
  if (sum !== 1) {
    const diff = Number((1 - sum).toFixed(6));
    alloc['SPY'] = Number(((alloc['SPY']||0) + diff).toFixed(4));
  }

  // prepare array output
  const allocations = Object.entries(alloc).map(([ticker, weight]) => ({ ticker, weight }));

  const rationale = `Rule-based allocation for risk=${risk}, horizon=${horizon}, goal=${goal}. Equity target ${Math.round(equity_target*100)}%`; 
  const risk_notes = `This is an educational, rule-based suggestion. It does not consider current market data or personalize taxes.`;

  return { allocations, rationale, risk_notes };
}

// API endpoint: get universe
app.get('/api/universe', (req, res) => {
  res.json({ universe: ETF_UNIVERSE });
});

// Simple auth endpoints
app.post('/signup', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'username and password required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    // Support both SQLite (db.type === 'sqlite', db.db) and Postgres (db.type === 'pg', db.pool)
    if (db.type === 'pg') {
      const r = await db.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id', [username, hash]);
      const userId = r.rows && r.rows[0] && r.rows[0].id;
      req.session.userId = userId;
      return res.json({ ok: true, userId });
    }

    // sqlite path: db.db is the better-sqlite3 Database instance
    const stmt = db.db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
    const info = stmt.run(username, hash);
    // better-sqlite3 returns { lastInsertRowid }
    req.session.userId = info.lastInsertRowid;
    res.json({ ok: true, userId: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'username and password required' });
  try {
    let row;
    if (db.type === 'pg') {
      const r = await db.query('SELECT id, password_hash FROM users WHERE username = $1', [username]);
      row = r.rows && r.rows[0];
    } else {
      row = db.db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username);
    }

    if (!row) return res.status(401).json({ ok: false, error: 'invalid credentials' });
    const okp = await bcrypt.compare(password, row.password_hash);
    if (!okp) return res.status(401).json({ ok: false, error: 'invalid credentials' });
    req.session.userId = row.id;
    res.json({ ok: true, userId: row.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    res.json({ ok: true });
  });
});

// API endpoint: recommend
app.post('/api/recommend', async (req, res) => {
  const profile = req.body || {};
  try {
    let finalResult = null;
    // Try LLM if key available
    const marketdata = require('./marketdata');
    const marketSummary = await (marketdata.summaryText().catch(()=>''));

    if (process.env.OPENAI_API_KEY && profile.useLLM) {
      try {
        const axios = require('axios');
        const userProfileText = `User profile:\n- risk: ${profile.risk}\n- horizon: ${profile.horizon}\n- goal: ${profile.goal}\n- constraints: ${JSON.stringify(profile.constraints || [])}`;
        const universeSummary = ETF_UNIVERSE.map(e=>`${e.ticker}: ${e.class}`).join('; ');
        const system = `You are a financial education assistant. Output ONLY valid JSON with keys: allocations (array of {ticker, weight}), rationale (string), risk_notes (string). Weights must sum to 1.0. When making allocations, consider the provided market snapshot.`;
        const user = `${userProfileText}\nMarket summary: ${marketSummary}\nEligible ETFs: ${universeSummary}\nReturn a diversified allocation adhering to the constraints.`;

        const payload = {
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          max_tokens: 800,
          temperature: 0.2
        };

        const resp = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          timeout: 15000
        });

        const text = resp.data?.choices?.[0]?.message?.content || '';
        try {
          const llmUtils = require('./llm_utils');
          const maybe = llmUtils.extractFirstJson(text);
          const universeTickers = ETF_UNIVERSE.map(e=>e.ticker);
          const valid = llmUtils.validateAllocations(maybe, universeTickers);
          if (valid.ok) {
            const norm = llmUtils.normalizeAllocations(maybe);
            finalResult = Object.assign({}, maybe, { allocations: norm.allocations });
          } else {
            console.warn('LLM validation failed:', valid.errors.join('; '));
          }
        } catch (e) {
          console.warn('LLM JSON parse/validate failed:', e.message);
        }
      } catch (e) {
        console.warn('LLM call failed', e.message);
      }
    }

    // fallback to rule-based if LLM not provided or failed
  if (!finalResult) finalResult = ruleBasedAllocation(profile);

    // save to storage (associate with user if logged in)
    try {
      const storage = require('./storage');
      await storage.saveRecommendation(req.sessionId, { profile, result: finalResult }, req.userId);
    } catch (e) { console.warn('saveRecommendation failed', e.message); }

    res.json({ ok: true, result: finalResult });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// history endpoint
app.get('/api/history', (req, res) => {
  try {
    const storage = require('./storage');
    storage.getHistory(req.sessionId, req.userId).then(history => res.json({ ok: true, history })).catch(e=>{
      res.status(500).json({ ok: false, error: e.message });
    });
    return;
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// scenario endpoint
app.post('/api/scenario', (req, res) => {
  (async () => {
    const { scenario, profile } = req.body || {};
    try {
      const mod = JSON.parse(JSON.stringify(profile || {}));
      if (scenario && scenario.type === 'rate-rise') {
        // simple stress: lower risk tolerance by 1
        mod.risk = Math.max(1, (Number(mod.risk) || 3) - 1);
      }

      const baseResult = ruleBasedAllocation(mod);

      // If LLM enabled and key present, ask LLM for scenario-aware allocation + rationale
      let llmResult = null;
      try {
        if (process.env.OPENAI_API_KEY && profile.useLLM) {
          const marketdata = require('./marketdata');
          const marketSummary = await marketdata.summaryText().catch(()=>'');
          const axios = require('axios');
          const system = `You are a financial education assistant. Output ONLY valid JSON with keys: allocations (array of {ticker, weight}), rationale (string), risk_notes (string). Weights must sum to 1.0. Be explicit about how the scenario changed the allocation.`;
          const user = `Scenario: ${JSON.stringify(scenario)}\nModified profile: risk=${mod.risk}, horizon=${mod.horizon}, goal=${mod.goal}\nMarket summary: ${marketSummary}\nEligible ETFs: ${ETF_UNIVERSE.map(e=>e.ticker).join(', ')}`;
          const payload = { model: 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 700, temperature: 0.2 };
          const resp = await axios.post('https://api.openai.com/v1/chat/completions', payload, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }, timeout: 15000 });
          const text = resp.data?.choices?.[0]?.message?.content || '';
          try {
            const llmUtils = require('./llm_utils');
            const maybe = llmUtils.extractFirstJson(text);
            const universeTickers = ETF_UNIVERSE.map(e=>e.ticker);
            const valid = llmUtils.validateAllocations(maybe, universeTickers);
            if (valid.ok) {
              const norm = llmUtils.normalizeAllocations(maybe);
              llmResult = Object.assign({}, maybe, { allocations: norm.allocations });
            } else {
              console.warn('LLM scenario validation failed:', valid.errors.join('; '));
            }
          } catch (e) { /* ignore parse errors */ }
        }
      } catch (e) { console.warn('LLM scenario call failed', e.message); }

      res.json({ ok: true, profile: mod, result: baseResult, llm_result: llmResult });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  })();
});




// Fallback for SPA
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