// Helpers to safely extract and validate LLM JSON outputs

function extractFirstJson(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/\{[\s\S]*\}/m);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    return null;
  }
}

function validateAllocations(obj, universeTickers) {
  const errors = [];
  if (!obj || !Array.isArray(obj.allocations)) {
    errors.push('allocations missing or not an array');
    return { ok: false, errors };
  }

  let sum = 0;
  for (const a of obj.allocations) {
    if (!a.ticker) { errors.push('allocation missing ticker'); continue; }
    if (universeTickers && !universeTickers.includes(a.ticker)) errors.push(`unknown ticker: ${a.ticker}`);
    const w = Number(a.weight);
    if (!isFinite(w) || w < 0) errors.push(`invalid weight for ${a.ticker}`);
    sum += isFinite(w) ? w : 0;
  }

  // allow small tolerance
  if (sum <= 0) errors.push('sum of weights is zero');

  return { ok: errors.length === 0, errors, sum };
}

function normalizeAllocations(obj) {
  // Coerce weights to numbers, normalize to sum=1, and bias tiny rounding diff to SPY if present
  const alloc = {};
  for (const a of (obj.allocations || [])) {
    const w = Number(a.weight) || 0;
    alloc[a.ticker] = (alloc[a.ticker] || 0) + w;
  }

  let total = Object.values(alloc).reduce((s,v)=>s+v,0) || 1;
  for (const k of Object.keys(alloc)) alloc[k] = Number((alloc[k]/total).toFixed(6));

  // fix rounding diff
  let sum = Object.values(alloc).reduce((s,v)=>s+v,0);
  sum = Number(sum.toFixed(6));
  if (sum !== 1) {
    const diff = Number((1 - sum).toFixed(6));
    if (alloc['SPY'] !== undefined) alloc['SPY'] = Number((alloc['SPY'] + diff).toFixed(6));
    else {
      // add to first ticker
      const first = Object.keys(alloc)[0];
      alloc[first] = Number((alloc[first] + diff).toFixed(6));
    }
  }

  const normalized = Object.entries(alloc).map(([ticker, weight]) => ({ ticker, weight }));
  const sum2 = normalized.reduce((s,a)=>s+a.weight,0);
  return { allocations: normalized, sum: sum2 };
}

module.exports = { extractFirstJson, validateAllocations, normalizeAllocations };
