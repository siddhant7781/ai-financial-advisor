document.addEventListener('DOMContentLoaded', () => {
  // mark JS as running
  try { const el = document.getElementById('js-check'); if (el) el.textContent = 'JS running'; } catch (e) { }
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
  fetch('/api/universe').then(r => r.json()).then(data => {
    const u = data.universe || [];
    universeEl.innerHTML = u.map(e => `<li><strong>${e.ticker}</strong>: ${e.class}</li>`).join('');
  }).catch(() => { universeEl.innerHTML = '<li>Unable to load universe</li>'; });

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
    const placeholder = document.getElementById('resultPlaceholder');
    const content = document.getElementById('resultContent');

    if (placeholder) placeholder.classList.add('hidden');
    if (content) content.classList.remove('hidden');

    explain.style.display = 'block';
    explain.innerHTML = '<div class="skeleton-loader" style="width:60%"></div><div class="skeleton-loader"></div><div class="skeleton-loader"></div>';
    result.classList.remove('hidden'); // Ensure parent is visible (though we removed hidden class in HTML, good safety)

    try {
      // Fetch rule-based first (always)
      const rulePayload = Object.assign({}, payload, { useLLM: false });
      const rulePromise = fetch('/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rulePayload) });

      // Fetch LLM only if enabled
      let llmPromise = null;
      if (payload.useLLM) {
        const llmPayload = Object.assign({}, payload, { useLLM: true });
        llmPromise = fetch('/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(llmPayload) });
      }

      const [rRes, lRes] = await Promise.all([
        rulePromise,
        llmPromise ? llmPromise : Promise.resolve(null)
      ]);

      const rData = await rRes.json();
      const lData = lRes ? await lRes.json() : null;

      if (!rData.ok) throw new Error(rData.error || 'Rule-based recommendation failed');
      // LLM may be unavailable; handle gracefully
      if (lData && !lData.ok) console.warn('LLM recommendation failed or unavailable', lData.error || lData);

      const ruleResult = rData.result || { allocations: [], rationale: '', risk_notes: '' };
      const llmResult = (lData && lData.ok) ? (lData.result || null) : null;

      // render rule-based in its panel
      const ruleEl = document.getElementById('explainRule');
      const llmEl = document.getElementById('explainLLM');
      explain.innerHTML = ''; // Clear loading message
      ruleEl.innerHTML = '';
      llmEl.innerHTML = '';

      // helper small renderer
      function renderPanel(container, title, resObj) {
        if (!container) return;
        const h = document.createElement('h3'); h.textContent = title;
        container.appendChild(h);
        const p = document.createElement('div');
        let html = '';
        if (resObj.rationale) html += `<p><strong>Rationale:</strong> ${resObj.rationale}</p>`;
        if (resObj.risk_notes) html += `<p class="muted"><strong>Risk Notes:</strong> ${resObj.risk_notes}</p>`;
        p.innerHTML = html;
        const tbl = document.createElement('table'); tbl.style.width = '100%';
        tbl.innerHTML = '<thead><tr><th>Ticker</th><th>Weight</th></tr></thead>' +
          '<tbody>' + (resObj.allocations || []).map(a => `<tr><td>${a.ticker}</td><td>${(a.weight * 100).toFixed(2)}%</td></tr>`).join('') + '</tbody>';
        container.appendChild(p);
        container.appendChild(tbl);
      }

      renderPanel(ruleEl, 'Rule-based recommendation', ruleResult);
      if (llmResult) {
        renderPanel(llmEl, 'LLM recommendation (OpenAI)', llmResult);
      } else {
        if (!payload.useLLM) {
          llmEl.innerHTML = '<div style="padding:1rem; text-align:center;"><p class="muted">You must tick the "Enable AI Analysis" button to get AI analysis.</p></div>';
        } else {
          llmEl.innerHTML = '<p class="muted">LLM result unavailable. Server may not have an API key configured or model call failed.</p>';
        }
      }

      // set default view: LLM if available, else Rule
      if (llmResult && llmResult.allocations && llmResult.allocations.length) {
        lastAllocations = llmResult.allocations;
        setChartMode('llm');
        // Show LLM panel, hide Rule panel
        ruleEl.classList.add('hidden');
        llmEl.classList.remove('hidden');
      } else {
        lastAllocations = ruleResult.allocations || [];
        setChartMode('rule');
        // Show Rule panel, hide LLM panel
        ruleEl.classList.remove('hidden');
        llmEl.classList.add('hidden');
      }

      if (mainChart) {
        const allocations = lastAllocations || [];
        mainChart.data.labels = allocations.map(a => a.ticker + ' ' + Math.round(a.weight * 100) + '%');
        mainChart.data.datasets[0].data = allocations.map(a => Math.round(a.weight * 100));
        mainChart.data.datasets[0].backgroundColor = allocations.map(() => `hsl(${Math.floor(Math.random() * 360)} 70% 60%)`);
        mainChart.update();
      }

      // enable buttons and wire them to show appropriate allocations
      if (btnShowRule) btnShowRule.disabled = false;
      // Always enable LLM button so user can see the message if they didn't check the box
      if (btnShowLLM) btnShowLLM.disabled = false;
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
    r.innerHTML = `<p><strong>Rationale:</strong> ${rationale}</p><p class="muted"><strong>Risk Notes:</strong> ${risk_notes}</p>`;
    const list = document.createElement('table');
    list.style.width = '100%';
    list.innerHTML = '<thead><tr><th>Ticker</th><th>Weight</th></tr></thead>' +
      '<tbody>' + allocs.map(a => `<tr><td>${a.ticker}</td><td>${(a.weight * 100).toFixed(2)}%</td></tr>`).join('') + '</tbody>';
    explain.appendChild(r);
    explain.appendChild(list);
  }

  function showAllocationsOnChart(allocations, chart = allocChart) {
    if (!chart) return;
    chart.data.labels = allocations.map(a => a.ticker + ' ' + Math.round(a.weight * 100) + '%');
    chart.data.datasets[0].data = allocations.map(a => Math.round(a.weight * 100));
    chart.data.datasets[0].backgroundColor = allocations.map(() => `hsl(${Math.floor(Math.random() * 360)} 70% 60%)`);
    chart.update();
  }

  function setChartMode(mode) {
    const el = document.getElementById('chartMode'); if (el) el.textContent = 'Mode: ' + (mode === 'llm' ? 'LLM' : 'rule-based');
  }

  // Chart click: update tradingview when a slice is clicked
  if (mainChart) {
    mainChart.options.onClick = function (evt, elements) {
      if (!elements || !elements.length) return;
      const idx = elements[0].index;
      const tick = lastAllocations[idx] && lastAllocations[idx].ticker;
      if (tick) updateTradingView(tick);
    };
  }

  // updateTradingView helper: directly use ticker without exchange mapping
  async function updateTradingView(ticker) {
    const container = document.getElementById('tv_chart_container');
    if (!container) return;
    container.innerHTML = '';
    if (!ticker || !window.TradingView) {
      container.innerHTML = '<div class="placeholder-state" style="padding: 2rem;"><p class="muted">Select an allocation to view market data.</p></div>';
      return;
    }
    container.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100%;color:var(--text-muted);">Loading chart for ' + ticker + '...</div>';
    try {
      new TradingView.widget({
        width: '100%', height: 420, symbol: ticker, interval: 'D', timezone: 'Etc/UTC',
        theme: 'light', style: '1', locale: 'en', toolbar_bg: '#f1f3f6',
        enable_publishing: false, allow_symbol_change: true, container_id: 'tv_chart_container'
      });
    } catch (e) {
      console.warn('TradingView widget error', e);
      container.innerHTML = '<p class="muted">Failed to load chart for ' + ticker + '.</p>';
    }
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
        historyOut.innerHTML = '<ul>' + d.history.map(h => `<li>${h.ts} — <pre>${JSON.stringify(h.payload.result, null, 2)}</pre></li>`).join('') + '</ul>';
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
        const res = await fetch('/api/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
        // Update main pie chart
        if (mainChart) {
          const allocations = rule.allocations;
          mainChart.data.labels = allocations.map(a => a.ticker + ' ' + Math.round(a.weight * 100) + '%');
          mainChart.data.datasets[0].data = allocations.map(a => Math.round(a.weight * 100));
          mainChart.data.datasets[0].backgroundColor = allocations.map(() => `hsl(${Math.floor(Math.random() * 360)} 70% 60%)`);
          mainChart.update();
        }
        // store for slice clicks
        lastAllocations = rule.allocations;
      }
      document.getElementById('explainRule').classList.remove('hidden');
      document.getElementById('explainLLM').classList.add('hidden');
      setChartMode('rule');
    } catch (e) { }
  });

  if (btnShowLLM) btnShowLLM.addEventListener('click', () => {
    try {
      // Always switch view to show message if no data
      document.getElementById('explainRule').classList.add('hidden');
      document.getElementById('explainLLM').classList.remove('hidden');
      setChartMode('llm');

      const llm = window._lastLLM;
      if (llm && llm.allocations) {
        showAllocationsOnChart(llm.allocations);
        updateTradingView((llm.allocations[0] && llm.allocations[0].ticker) || null);
        // Update main pie chart
        if (mainChart) {
          const allocations = llm.allocations;
          mainChart.data.labels = allocations.map(a => a.ticker + ' ' + Math.round(a.weight * 100) + '%');
          mainChart.data.datasets[0].data = allocations.map(a => Math.round(a.weight * 100));
          mainChart.data.datasets[0].backgroundColor = allocations.map(() => `hsl(${Math.floor(Math.random() * 360)} 70% 60%)`);
          mainChart.update();
        }
        // store for slice clicks
        lastAllocations = llm.allocations;
      }
    } catch (e) { }
  });
});
