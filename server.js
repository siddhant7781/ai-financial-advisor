require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend
app.use('/', express.static(path.join(__dirname, 'public')));

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

// API endpoint: recommend
app.post('/api/recommend', async (req, res) => {
  const profile = req.body || {};

  try {
    // Always use OpenAI if key is set
    if (process.env.OPENAI_API_KEY) {
      const axios = require('axios');
      const userProfileText = `User profile:\n- risk: ${profile.risk}\n- horizon: ${profile.horizon}\n- goal: ${profile.goal}\n- constraints: ${JSON.stringify(profile.constraints || [])}`;
      const universeSummary = ETF_UNIVERSE.map(e=>`${e.ticker}: ${e.class}`).join('; ');
      const system = `You are a financial education assistant. Output ONLY valid JSON with keys: allocations (array of {ticker, weight}), rationale (string), risk_notes (string). Weights must sum to 1.0.`;
      const user = `${userProfileText}\nEligible ETFs: ${universeSummary}\nReturn a diversified allocation adhering to the constraints.`;

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

      const text = resp.data?.choices?.[0]?.message?.content;
      let llmResult = null;

      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/m);
        const jsonText = jsonMatch ? jsonMatch[0] : text;
        llmResult = JSON.parse(jsonText);
      } catch (e) {
        return res.json({ ok: true, result: ruleBasedAllocation(profile), llm_raw: text, llm_error: 'failed to parse JSON' });
      }

      if (llmResult && llmResult.allocations) {
        return res.json({ ok: true, result: llmResult });
      }
    }

    // fallback if no key
    res.json({ ok: true, result: ruleBasedAllocation(profile) });

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});


// Fallback for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`AI Financial Advisor prototype running at http://localhost:${PORT}`);
  if (!process.env.OPENAI_API_KEY) console.log('OPENAI_API_KEY not set — LLM calls will be skipped.');
});