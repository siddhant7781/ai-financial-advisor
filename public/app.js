document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('profileForm');
  const result = document.getElementById('result');
  const jsonOut = document.getElementById('jsonOut');
  const explain = document.getElementById('explain');
  const universeEl = document.getElementById('universe');

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

    jsonOut.textContent = 'Loading...';
    explain.innerHTML = '';
    result.classList.remove('hidden');

    try {
      const res = await fetch('/api/recommend', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Unknown error');
      jsonOut.textContent = JSON.stringify(data.result.allocations, null, 2);
      explain.innerHTML = `<p>${data.result.rationale}</p><p class="muted">${data.result.risk_notes}</p>`;
    } catch (err) {
      jsonOut.textContent = 'Error: ' + (err.message || err);
    }
  });
});
