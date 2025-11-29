const axios = require('axios');

// Simple market data helper using Yahoo Finance public endpoints. This is best-effort and cached briefly.
const CACHE_TTL = 60 * 1000; // 1 minute
let _cache = { ts: 0, data: null };

async function fetchQuote(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`;
    const r = await axios.get(url, { timeout: 5000 });
    const q = r.data?.quoteResponse?.result?.[0];
    if (!q) return null;
    return {
      ticker: q.symbol,
      price: q.regularMarketPrice,
      change: q.regularMarketChangePercent,
      marketTime: q.regularMarketTime
    };
  } catch (e) {
    return null;
  }
}

async function snapshot() {
  const now = Date.now();
  if (_cache.data && (now - _cache.ts) < CACHE_TTL) return _cache.data;

  // tickers: VIX is ^VIX on Yahoo, 10y prox: IEF (7-10yr), and core ETF list
  const tickers = ['^VIX','IEF','SPY','QQQ','VEA','VWO','BND','VNQ','GLD'];
  const promises = tickers.map(t => fetchQuote(t));
  const results = await Promise.all(promises);

  const data = {};
  for (const r of results) if (r && r.ticker) data[r.ticker] = r;

  _cache = { ts: now, data };
  return data;
}

// Build a short human-friendly market summary
async function summaryText() {
  const s = await snapshot();
  const parts = [];
  if (s['^VIX']) parts.push(`VIX ${s['^VIX'].price} (${Number(s['^VIX'].change).toFixed(2)}%)`);
  if (s['IEF']) parts.push(`IEF ${s['IEF'].price} (${Number(s['IEF'].change).toFixed(2)}%)`);
  if (s['SPY']) parts.push(`SPY ${s['SPY'].price} (${Number(s['SPY'].change).toFixed(2)}%)`);
  return parts.join(' | ');
}

module.exports = { snapshot, summaryText, fetchQuote };
