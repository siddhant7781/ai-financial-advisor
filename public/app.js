document.addEventListener('DOMContentLoaded', () => {
  // mark JS as running
  try { const el = document.getElementById('js-check'); if (el) el.textContent = 'JS running'; } catch(e) {}
  const form = document.getElementById('profileForm');
  const result = document.getElementById('result');
  const explain = document.getElementById('explain');
  let lastAllocations = [];
  const universeEl = document.getElementById('universe');
  const chartCtx = document.getElementById('mainAllocChart')?.getContext('2d');
  let mainChart = null;
  if (chartCtx) {
    mainChart = new Chart(chartCtx, {
      type: 'pie',
      data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] },
      options: { responsive: true }
    });
  }

  // allocation chart used in dashboard
  const allocCtx = document.getElementById('allocChart')?.getContext('2d');
  let allocChart = null;
  if (allocCtx) {
    allocChart = new Chart(allocCtx, { type: 'pie', data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] }, options: { responsive: true } });
  }

  // load universe
  fetch('/api/universe').then(r=>r.json()).then(data=>{
    const u = data.universe || [];
    universeEl.innerHTML = u.map(e=>`<li><strong>${e.ticker}</strong>: ${e.class}</li>`).join('');
  }).catch(()=>{ universeEl.innerHTML = '<li>Unable to load universe</li>'; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {};
    payload.horizon = fd.get('horizon');
    payload.risk = fd.get('risk');
    payload.drawdown = fd.get('drawdown');
    payload.liquidity = fd.get('liquidity');
    payload.goal = fd.get('goal');
    payload.rebalance = fd.get('rebalance');
    payload.tax = fd.get('tax');
  payload.useLLM = fd.get('useLLM') ? true : false;
    // constraints can be multiple
    payload.constraints = fd.getAll('constraints');

    // show loading state in both explain areas
    explain.innerHTML = '<p class="muted">Loading both rule-based and LLM recommendations...</p>';
    result.classList.remove('hidden');

    try {
      // Fetch rule-based first (no LLM)
      const rulePayload = Object.assign({}, payload, { useLLM: false });
      const llmPayload = Object.assign({}, payload, { useLLM: true });

      const [rRes, lRes] = await Promise.all([
        fetch('/api/recommend', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(rulePayload) }),
        fetch('/api/recommend', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(llmPayload) })
      ]);

      const [rData, lData] = await Promise.all([rRes.json(), lRes.json()]);

      if (!rData.ok) throw new Error(rData.error || 'Rule-based recommendation failed');
      // LLM may be unavailable; handle gracefully
      if (!lData.ok) console.warn('LLM recommendation failed or unavailable', lData.error || lData);

      const ruleResult = rData.result || { allocations: [], rationale: '', risk_notes: '' };
      const llmResult = (lData && lData.ok) ? (lData.result || null) : null;

      // render rule-based in its panel
      const ruleEl = document.getElementById('explainRule');
      const llmEl = document.getElementById('explainLLM');
      ruleEl.innerHTML = '';
      llmEl.innerHTML = '';

      // helper small renderer
      function renderPanel(container, title, resObj) {
        if (!container) return;
        const h = document.createElement('h3'); h.textContent = title;
        container.appendChild(h);
        const p = document.createElement('div'); p.innerHTML = `<p>${resObj.rationale || ''}</p><p class="muted">${resObj.risk_notes || ''}</p>`;
        const tbl = document.createElement('table'); tbl.style.width = '100%';
        tbl.innerHTML = '<thead><tr><th>Ticker</th><th>Weight</th></tr></thead>' +
          '<tbody>' + (resObj.allocations || []).map(a=>`<tr><td>${a.ticker}</td><td>${(a.weight*100).toFixed(2)}%</td></tr>`).join('') + '</tbody>';
        container.appendChild(p);
        container.appendChild(tbl);
      }

      renderPanel(ruleEl, 'Rule-based recommendation', ruleResult);
      if (llmResult) {
        renderPanel(llmEl, 'LLM recommendation (OpenAI)', llmResult);
      } else {
        llmEl.innerHTML = '<p class="muted">LLM result unavailable. Server may not have an API key configured or model call failed.</p>';
      }

      // set lastAllocations to rule by default and update mainChart
      lastAllocations = ruleResult.allocations || [];
      if (mainChart) {
        const allocations = lastAllocations || [];
        mainChart.data.labels = allocations.map(a => a.ticker + ' ' + Math.round(a.weight*100) + '%');
        mainChart.data.datasets[0].data = allocations.map(a => Math.round(a.weight*100));
        mainChart.data.datasets[0].backgroundColor = allocations.map(() => `hsl(${Math.floor(Math.random()*360)} 70% 60%)`);
        mainChart.update();
      }

      // enable buttons and wire them to show appropriate allocations
      if (btnShowRule) btnShowRule.disabled = false;
      if (btnShowLLM) btnShowLLM.disabled = !(llmResult && llmResult.allocations && llmResult.allocations.length);
      document.getElementById('scenarioRule')?.textContent && (document.getElementById('scenarioRule').textContent = JSON.stringify(ruleResult, null, 2));
      // store references for chart toggles
      window._lastRule = ruleResult;
      window._lastLLM = llmResult;

      // initialize tradingview with top ticker from current shown allocations
      try { updateTradingView((lastAllocations[0] && lastAllocations[0].ticker) || null); } catch (e) { console.warn('updateTradingView fail', e); }

    } catch (err) {
      explain.textContent = 'Error: ' + (err.message || err);
    }
  });

  // helper to render allocations and rationale
  function renderAllocations(allocs, rationale, risk_notes) {
    explain.innerHTML = '';
    const r = document.createElement('div');
    r.innerHTML = `<p>${rationale}</p><p class="muted">${risk_notes}</p>`;
    const list = document.createElement('table');
    list.style.width = '100%';
    list.innerHTML = '<thead><tr><th>Ticker</th><th>Weight</th></tr></thead>' +
      '<tbody>' + allocs.map(a=>`<tr><td>${a.ticker}</td><td>${(a.weight*100).toFixed(2)}%</td></tr>`).join('') + '</tbody>';
    explain.appendChild(r);
    explain.appendChild(list);
  }

  function showAllocationsOnChart(allocations, chart = allocChart) {
    if (!chart) return;
    chart.data.labels = allocations.map(a => a.ticker + ' ' + Math.round(a.weight*100) + '%');
    chart.data.datasets[0].data = allocations.map(a => Math.round(a.weight*100));
    chart.data.datasets[0].backgroundColor = allocations.map(() => `hsl(${Math.floor(Math.random()*360)} 70% 60%)`);
    chart.update();
  }

  function setChartMode(mode) {
    const el = document.getElementById('chartMode'); if (el) el.textContent = 'Mode: ' + (mode === 'llm' ? 'LLM' : 'rule-based');
  }

  // Chart click: update tradingview when a slice is clicked
  if (mainChart) {
    mainChart.options.onClick = function(evt, elements) {
      if (!elements || !elements.length) return;
      const idx = elements[0].index;
      const tick = lastAllocations[idx] && lastAllocations[idx].ticker;
      if (tick) updateTradingView(tick);
    };
  }

  // updateTradingView helper: tries exchange mapping and fallbacks
  async function updateTradingView(ticker) {
    const container = document.getElementById('tv_chart_container');
    if (!container) return;
    container.innerHTML = '';
    if (!ticker || !window.TradingView) {
      container.innerHTML = '<p class="muted">No ticker or TradingView not loaded.</p>';
      return;
    }

    const exchangeMap = {
      SPY: 'NYSEARCA', IJR: 'NYSEARCA', VEA: 'NYSEARCA', VWO: 'NYSEARCA', QQQ: 'NASDAQ', VTV: 'NYSEARCA',
      BND: 'NYSEARCA', AGG: 'AMEX', IEF: 'NYSEARCA', TIP: 'NYSEARCA', SHY: 'NYSEARCA',
      VNQ: 'NYSEARCA', GLD: 'NYSEARCA', DBC: 'NYSEARCA', BIL: 'NYSEARCA'
    };

    const tried = [];
    const exchanges = [];
    if (exchangeMap[ticker]) exchanges.push(exchangeMap[ticker]);
    // fallback order
    exchanges.push('NYSEARCA','AMEX','ARCA','NASDAQ','NYSE');

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    for (const ex of exchanges) {
      const sym = `${ex}:${ticker}`;
      tried.push(sym);
      container.innerHTML = '';
      try {
        new TradingView.widget({
          width: '100%', height: 420, symbol: sym, interval: 'D', timezone: 'Etc/UTC', theme: 'light', style: '1', locale: 'en', toolbar_bg: '#f1f3f6', enable_publishing: false, allow_symbol_change: true, container_id: 'tv_chart_container'
        });
        // wait a moment for TradingView to render and potentially show 'Invalid symbol'
        await sleep(900);
        const txt = container.innerText || '';
        if (/invalid symbol/i.test(txt) || /doesn't exist/i.test(txt) || /symbol doesn't exist/i.test(txt)) {
          // invalid symbol, try next
          container.innerHTML = '';
          continue;
        }
        // success
        return;
      } catch (e) {
        // creation threw — try next
        container.innerHTML = '';
        continue;
      }
    }

    // If TradingView couldn't load the symbol, show a single failure message
    container.innerHTML = `<p class="muted">TradingView failed for ${ticker}. Tried: ${tried.join(', ')}.</p>`;
  }

  // HISTORY and scenario handlers (dashboard functionality)
  const btnHistory = document.getElementById('btnHistory');
  const historyOut = document.getElementById('historyOut');
  if (btnHistory) {
    btnHistory.addEventListener('click', async () => {
      historyOut.textContent = 'Loading...';
      try {
        const res = await fetch('/api/history');
        const d = await res.json();
        if (!d.ok) throw new Error(d.error || 'failed');
        historyOut.innerHTML = '<ul>' + d.history.map(h=>`<li>${h.ts} — <pre>${JSON.stringify(h.payload.result, null, 2)}</pre></li>`).join('') + '</ul>';
      } catch (e) {
        historyOut.textContent = 'Error: ' + e.message;
      }
    });
  }

  const btnScenario = document.getElementById('btnScenario');
  const btnShowRule = document.getElementById('btnShowRule');
  const btnShowLLM = document.getElementById('btnShowLLM');
  if (btnScenario) {
    btnScenario.addEventListener('click', async () => {
      document.getElementById('allocJson').textContent = 'Running scenario...';
      const payload = { scenario: { type: 'rate-rise', shift: 0.01 }, profile: { risk: 3, horizon: '5-10y', goal: 'balanced', useLLM: true } };
      try {
        const res = await fetch('/api/scenario', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        const d = await res.json();
        if (!d.ok) throw new Error(d.error || 'failed');

        const rule = d.result || { allocations: [] };
        document.getElementById('scenarioRule').textContent = JSON.stringify(rule, null, 2);
        document.getElementById('rationale').textContent = rule.rationale || '';
        document.getElementById('riskNotes').textContent = rule.risk_notes || '';

        const llm = d.llm_result || null;
        document.getElementById('scenarioLLM').textContent = llm ? JSON.stringify(llm, null, 2) + '\n\nRationale:\n' + (llm.rationale || '') + '\n\nRisk notes:\n' + (llm.risk_notes || '') : '(no LLM result)';

        document.getElementById('allocJson').textContent = JSON.stringify(rule, null, 2);
        showAllocationsOnChart(rule.allocations);

        if (btnShowRule) btnShowRule.disabled = false;
        if (btnShowLLM) btnShowLLM.disabled = !(llm && llm.allocations && llm.allocations.length);
        setChartMode('rule');
      } catch (e) {
        document.getElementById('allocJson').textContent = 'Error: ' + e.message;
      }
    });
  }

  if (btnShowRule) btnShowRule.addEventListener('click', () => {
    try {
      const rule = window._lastRule || JSON.parse(document.getElementById('scenarioRule')?.textContent || '{}');
      if (rule && rule.allocations) {
        showAllocationsOnChart(rule.allocations);
        updateTradingView((rule.allocations[0] && rule.allocations[0].ticker) || null);
      }
      setChartMode('rule');
    } catch(e){}
  });

  if (btnShowLLM) btnShowLLM.addEventListener('click', () => {
    try {
      const llm = window._lastLLM;
      if (llm && llm.allocations) {
        showAllocationsOnChart(llm.allocations);
        updateTradingView((llm.allocations[0] && llm.allocations[0].ticker) || null);
        setChartMode('llm');
      }
    } catch (e) {}
  });
});
