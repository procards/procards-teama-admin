// ProCards - Team A — App Logic

const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
let AGENTS = [];
let AGENCIES = [];
let BANKS = { ORC: [], ECR: [] };
let UB_CODES = [];
let charts = {};
let editingTurnInId = null;

function syncToSheet(record, action = 'save') {
  if (!CONFIG.GOOGLE_SHEET_WEBHOOK_URL || CONFIG.GOOGLE_SHEET_WEBHOOK_URL.startsWith('YOUR-')) return;
  fetch(CONFIG.GOOGLE_SHEET_WEBHOOK_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ ...record, action })
  }).catch(e => console.warn('Sheet sync failed', e));
}

// ---------- PIN GATE ----------
function checkPin() {
  const val = document.getElementById('pinInput').value;
  if (val === CONFIG.APP_PIN) {
    document.getElementById('pinGate').style.display = 'none';
    document.getElementById('app').classList.add('unlocked');
    initApp();
  } else {
    document.getElementById('pinError').textContent = 'Wrong PIN';
  }
}
document.getElementById('pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkPin(); });

// ---------- TABS ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).style.display = 'block';
    if (btn.dataset.tab === 'summary') loadSummary();
    if (btn.dataset.tab === 'volume') { loadVolume('turnins'); loadVolume('approvals'); }
    if (btn.dataset.tab === 'settings') renderSettings();
  });
});

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 2500);
}

// ---------- INIT ----------
async function initApp() {
  await loadAgents();
  await loadAgencies();
  await loadBanks();
  await loadUbCodes();
  populateAgencyDropdowns();
  document.getElementById('ti-date').valueAsDate = new Date();
  document.getElementById('summary-send-date').valueAsDate = new Date();
  loadRecentTurnIns();
  setupDateFilter('ti-datefilter', () => loadVolume('turnins'));
  setupDateFilter('ap-datefilter', () => loadVolume('approvals'));
  setupGroupToggle('ti-grouptoggle', () => loadVolume('turnins'));
  setupGroupToggle('ap-grouptoggle', () => loadVolume('approvals'));
}

async function loadAgents() {
  const { data } = await sb.from('agents').select('*').order('name');
  AGENTS = data || [];
  const sel = document.getElementById('ti-agent');
  sel.innerHTML = '<option value="">Select agent</option>' +
    AGENTS.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  const summarySel = document.getElementById('summary-agent-select');
  summarySel.innerHTML = '<option value="">Select agent</option>' +
    AGENTS.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  const ubSel = document.getElementById('set-ub-agent');
  ubSel.innerHTML = AGENTS.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  const recentAgentFilter = document.getElementById('ti-recent-agentfilter');
  recentAgentFilter.innerHTML = '<option value="">All agents</option>' +
    AGENTS.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
}

async function loadAgencies() {
  const { data } = await sb.from('agencies').select('*').order('name');
  AGENCIES = data || [];
}

function populateAgencyDropdowns() {
  const names = AGENCIES.map(a => a.name);

  const tiSel = document.getElementById('ti-agency');
  tiSel.innerHTML = '<option value="">Select agency</option>' +
    names.map(n => `<option value="${n}">${n}</option>`).join('');

  const srSel = document.getElementById('sr-agency');
  srSel.innerHTML = '<option value="">Select agency</option>' +
    names.map(n => `<option value="${n}">${n}</option>`).join('') +
    '<option value="Unionbank">Unionbank</option>';

  const sumSel = document.getElementById('sum-agency');
  sumSel.innerHTML = '<option value="">All agencies</option>' +
    names.map(n => `<option value="${n}">${n}</option>`).join('') +
    '<option value="Unionbank">Unionbank</option>';
}

async function loadBanks() {
  const { data } = await sb.from('banks').select('*').order('bank_name');
  BANKS = {};
  (data || []).forEach(b => {
    if (!BANKS[b.agency]) BANKS[b.agency] = [];
    BANKS[b.agency].push(b);
  });
}

async function loadUbCodes() {
  const { data } = await sb.from('unionbank_agent_codes').select('*, agents(name)');
  UB_CODES = data || [];
}

// ---------- TAB 1: TURN-IN ----------
function onAgencyChange() {
  const agency = document.getElementById('ti-agency').value;
  const bankWrap = document.getElementById('ti-bank-wrap');
  const isKnownAgency = AGENCIES.some(a => a.name === agency);
  if (isKnownAgency) {
    bankWrap.style.display = 'block';
    const list = BANKS[agency] || [];
    const banksDiv = document.getElementById('ti-banks');
    if (list.length === 0) {
      banksDiv.innerHTML = `<p style="color:var(--text-muted); font-size:13px">No banks added for ${agency} yet — add one in Settings.</p>`;
    } else if (list.length === 1) {
      banksDiv.innerHTML = `<label><input type="checkbox" value="${list[0].bank_name}" checked disabled> ${list[0].bank_name}</label>`;
    } else {
      banksDiv.innerHTML = list.map(b => `<label><input type="checkbox" value="${b.bank_name}"> ${b.bank_name}</label>`).join('');
    }
  } else {
    bankWrap.style.display = 'none';
  }
}

async function submitTurnIn() {
  const agency = document.getElementById('ti-agency').value;
  const agentId = document.getElementById('ti-agent').value;
  const client = document.getElementById('ti-client').value.trim();
  const date = document.getElementById('ti-date').value;
  const encodedBy = document.getElementById('ti-encodedby').value.trim();

  if (!agency || !agentId || !client || !date || !encodedBy) {
    toast('Fill in all fields before saving.');
    return;
  }
  const agent = AGENTS.find(a => a.id === agentId);
  const banks = Array.from(document.querySelectorAll('#ti-banks input:checked')).map(i => i.value);
  if (banks.length === 0) { toast('Select at least one bank.'); return; }

  const record = {
    agency, banks, agent_id: agentId, agent_name: agent.name,
    client_name: client, date_turn_in: date, encoded_by: encodedBy
  };

  let error, savedId = editingTurnInId;
  if (editingTurnInId) {
    ({ error } = await sb.from('turn_ins').update(record).eq('id', editingTurnInId));
  } else {
    const result = await sb.from('turn_ins').insert(record).select().single();
    error = result.error;
    savedId = result.data ? result.data.id : null;
  }

  if (error) { toast('Save failed: ' + error.message); return; }

  if (savedId) syncToSheet({ id: savedId, ...record }, 'save');

  toast(editingTurnInId ? 'Turn-in updated.' : 'Turn-in saved.');
  cancelEditTurnIn();
  document.getElementById('ti-client').value = '';
  loadRecentTurnIns();
}

function editTurnIn(id) {
  const row = LAST_TURN_INS.find(t => t.id === id);
  if (!row) return;
  editingTurnInId = id;

  document.getElementById('ti-agency').value = row.agency;
  onAgencyChange();
  document.getElementById('ti-agent').value = row.agent_id;
  document.getElementById('ti-client').value = row.client_name;
  document.getElementById('ti-date').value = row.date_turn_in;
  document.getElementById('ti-encodedby').value = row.encoded_by;
  setTimeout(() => {
    document.querySelectorAll('#ti-banks input').forEach(cb => {
      if ((row.banks || []).includes(cb.value)) cb.checked = true;
    });
  }, 0);

  document.getElementById('save-turnin-btn').textContent = 'Update Turn-In';
  document.getElementById('cancel-edit-btn').style.display = 'inline-block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEditTurnIn() {
  editingTurnInId = null;
  document.getElementById('save-turnin-btn').textContent = 'Save Turn-In';
  document.getElementById('cancel-edit-btn').style.display = 'none';
}

async function deleteTurnIn(id) {
  if (!confirm('Delete this turn-in? This cannot be undone.')) return;
  const { error } = await sb.from('turn_ins').delete().eq('id', id);
  if (error) { toast('Delete failed: ' + error.message); return; }
  syncToSheet({ id }, 'delete');
  toast('Turn-in deleted.');
  loadRecentTurnIns();
}

async function duplicateLastEntry() {
  const { data } = await sb.from('turn_ins').select('*').order('created_at', { ascending: false }).limit(1);
  if (!data || !data.length) return;
  const last = data[0];
  document.getElementById('ti-agency').value = last.agency;
  onAgencyChange();
  document.getElementById('ti-agent').value = last.agent_id;
  onAgentChange();
  if (last.banks) {
    document.querySelectorAll('#ti-banks input').forEach(cb => {
      if (last.banks.includes(cb.value)) cb.checked = true;
    });
  }
  document.getElementById('ti-encodedby').value = last.encoded_by;
  document.getElementById('ti-client').value = '';
  document.getElementById('ti-client').focus();
}

let currentSummaryEntries = [];

async function onSummarySelectionChange() {
  const date = document.getElementById('summary-send-date').value;
  const agentId = document.getElementById('summary-agent-select').value;
  const box = document.getElementById('summary-preview');
  const sendBtn = document.getElementById('summary-send-btn');

  if (!date || !agentId) {
    box.innerHTML = '';
    sendBtn.style.display = 'none';
    currentSummaryEntries = [];
    return;
  }

  const { data, error } = await sb.from('turn_ins').select('*').eq('date_turn_in', date).eq('agent_id', agentId);
  if (error) { toast('Load failed: ' + error.message); return; }
  currentSummaryEntries = data || [];

  const agent = AGENTS.find(a => a.id === agentId);

  if (!currentSummaryEntries.length) {
    box.innerHTML = `<p style="color:var(--text-muted); font-size:13px">No turn-ins found for ${agent.name} on this date.</p>`;
    sendBtn.style.display = 'none';
    return;
  }

  const byAgency = {};
  const byBank = {};
  currentSummaryEntries.forEach(e => {
    byAgency[e.agency] = (byAgency[e.agency] || 0) + 1;
    (e.banks || []).forEach(b => byBank[b] = (byBank[b] || 0) + 1);
  });
  const alreadySent = currentSummaryEntries.every(e => e.email_sent);

  box.innerHTML = `
    <div class="stat-row">
      <div class="stat-card"><div class="num">${currentSummaryEntries.length}</div><div class="label">Total Turn-Ins</div></div>
    </div>
    <p style="font-size:13px; margin-top:0"><strong>Email:</strong> ${agent.email || '⚠ no email on file — add one in Settings'}</p>
    <p style="font-size:13px; margin-bottom:4px"><strong>By Agency:</strong> ${Object.entries(byAgency).map(([k,v]) => `${k}: ${v}`).join(', ')}</p>
    <p style="font-size:13px; margin-bottom:4px"><strong>By Bank:</strong> ${Object.entries(byBank).map(([k,v]) => `${k}: ${v}`).join(', ')}</p>
    ${alreadySent ? '<p style="font-size:12px; color:var(--gold-light)">Note: a summary for these entries was already sent — sending again will resend.</p>' : ''}
  `;

  sendBtn.style.display = agent.email ? 'inline-block' : 'none';
}

async function sendAgentSummaryEmail() {
  const date = document.getElementById('summary-send-date').value;
  const agentId = document.getElementById('summary-agent-select').value;
  const agent = AGENTS.find(a => a.id === agentId);
  if (!agent || !currentSummaryEntries.length) return;

  const summaryList = currentSummaryEntries.map(e =>
    `${e.client_name} — ${e.agency} (${(e.banks || []).join(', ')})`
  ).join('\n');

  try {
    await emailjs.send(CONFIG.EMAILJS_SERVICE_ID, CONFIG.EMAILJS_TEMPLATE_ID, {
      to_email: agent.email,
      agent_name: agent.name,
      date_turn_in: date,
      total_count: currentSummaryEntries.length,
      turn_ins_summary: summaryList
    }, CONFIG.EMAILJS_PUBLIC_KEY);

    const ids = currentSummaryEntries.map(e => e.id);
    await sb.from('turn_ins').update({ email_sent: true }).in('id', ids);
    document.getElementById('summary-send-result').textContent = `Sent to ${agent.name} (${agent.email}).`;
    loadRecentTurnIns();
    onSummarySelectionChange();
  } catch (e) {
    console.error('Email failed', e);
    document.getElementById('summary-send-result').textContent = `Send failed — check the browser console (F12) for the exact EmailJS error.`;
  }
}

let LAST_TURN_INS = [];

let recentSearchDebounce = null;
function onRecentSearchInput() {
  clearTimeout(recentSearchDebounce);
  recentSearchDebounce = setTimeout(loadRecentTurnIns, 300);
}

async function loadRecentTurnIns() {
  const dateFilter = document.getElementById('ti-recent-datefilter').value;
  const agentFilter = document.getElementById('ti-recent-agentfilter').value;
  const searchFilter = document.getElementById('ti-recent-searchfilter').value.trim();

  let query = sb.from('turn_ins').select('*').order('created_at', { ascending: false });
  if (dateFilter) query = query.eq('date_turn_in', dateFilter);
  if (agentFilter) query = query.eq('agent_name', agentFilter);
  if (searchFilter) query = query.ilike('client_name', `%${searchFilter}%`);
  if (!dateFilter && !agentFilter && !searchFilter) query = query.limit(25);

  const { data } = await query;
  LAST_TURN_INS = data || [];

  const heading = document.getElementById('ti-recent-heading');
  const parts = [];
  if (searchFilter) parts.push(`matching "${searchFilter}"`);
  if (agentFilter) parts.push(`for ${agentFilter}`);
  if (dateFilter) parts.push(`on ${dateFilter}`);
  heading.textContent = parts.length ? `Turn-Ins ${parts.join(' ')}` : 'Recent Turn-Ins';

  const tbody = document.getElementById('ti-recent-table');
  if (!LAST_TURN_INS.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted)">No turn-ins found${parts.length ? ' for this filter' : ''}.</td></tr>`;
    return;
  }
  tbody.innerHTML = LAST_TURN_INS.map(t => `
    <tr>
      <td>${t.date_turn_in}</td>
      <td>${t.agency}</td>
      <td>${t.client_name}</td>
      <td>${t.agent_name}</td>
      <td>${(t.banks || []).join(', ')}</td>
      <td>${t.encoded_by}</td>
      <td>
        <button class="icon-btn" onclick="editTurnIn('${t.id}')">Edit</button>
        <button class="icon-btn danger" onclick="deleteTurnIn('${t.id}')">Delete</button>
      </td>
    </tr>`).join('');
}

function clearRecentFilters() {
  document.getElementById('ti-recent-datefilter').value = '';
  document.getElementById('ti-recent-agentfilter').value = '';
  document.getElementById('ti-recent-searchfilter').value = '';
  loadRecentTurnIns();
}

// ---------- TAB 2: SCREEN REPORT ----------
async function handleFileUpload(event) {
  const agency = document.getElementById('sr-agency').value;
  if (!agency) { toast('Select the agency first.'); event.target.value = ''; return; }
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const wb = XLSX.read(e.target.result, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    await processApprovalRows(rows, agency);
  };
  reader.readAsArrayBuffer(file);
}

function findField(row, candidates) {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const hit = keys.find(k => k.toLowerCase().trim().includes(c));
    if (hit) return row[hit];
  }
  return '';
}

async function processApprovalRows(rows, agency) {
  const results = [];
  for (const row of rows) {
    const clientName = String(findField(row, ['client', 'name'])).trim();
    if (!clientName) continue;
    const cardType = String(findField(row, ['card type', 'card']));
    const bankName = String(findField(row, ['bank']));
    const creditLimit = String(findField(row, ['credit limit', 'limit']));

    const match = agency === 'Unionbank'
      ? matchByAgentCode(row)
      : await matchClientToTurnIn(clientName, agency, bankName);
    const record = {
      agency, client_name: clientName, card_type: cardType,
      credit_limit: creditLimit, bank_name: bankName,
      assigned_agent: match.assignedAgent,
      matched_turn_in_id: match.turnInId,
      match_status: match.status,
      duplicate_note: match.note
    };
    const { error } = await sb.from('approvals').insert(record);
    results.push({ ...record, error });
  }
  renderScreenPreview(results);
  toast(`Processed ${results.length} rows.`);
}

function matchByAgentCode(row) {
  const code = String(findField(row, ['agent code', 'code'])).trim();
  if (!code) {
    return { assignedAgent: 'Outside Agent', turnInId: null, status: 'outside_agent', note: 'No agent code found in report row' };
  }
  const match = UB_CODES.find(c => c.agent_code.toLowerCase() === code.toLowerCase());
  if (!match) {
    return { assignedAgent: 'Outside Agent', turnInId: null, status: 'outside_agent', note: `Agent code "${code}" not on file` };
  }
  return { assignedAgent: match.agents ? match.agents.name : 'Unknown', turnInId: null, status: 'matched', note: null };
}

async function matchClientToTurnIn(clientName, agency, bankName) {
  let query = sb.from('turn_ins').select('*').eq('agency', agency).ilike('client_name', clientName);
  const { data } = await query;
  let candidates = data || [];

  if (agency !== 'Unionbank' && bankName) {
    candidates = candidates.filter(t => (t.banks || []).some(b => b.toLowerCase().includes(bankName.toLowerCase()) || bankName.toLowerCase().includes(b.toLowerCase())));
  }

  if (candidates.length === 0) {
    return { assignedAgent: 'Outside Agent', turnInId: null, status: 'outside_agent', note: null };
  }
  candidates.sort((a, b) => new Date(a.date_turn_in) - new Date(b.date_turn_in));
  const winner = candidates[0];
  const losers = candidates.slice(1);
  const note = losers.length
    ? `Duplicate turn-in(s) by: ${losers.map(l => l.agent_name).join(', ')} (not awarded — later date)`
    : null;
  return { assignedAgent: winner.agent_name, turnInId: winner.id, status: 'matched', note };
}

function renderScreenPreview(results) {
  const wrap = document.getElementById('sr-preview');
  wrap.innerHTML = `
    <h3 style="margin-top:24px">Screened Results (${results.length})</h3>
    <table>
      <thead><tr><th>Client</th><th>Card Type</th><th>Bank</th><th>Assigned Agent</th><th>Status</th></tr></thead>
      <tbody>
        ${results.map(r => `
          <tr>
            <td>${r.client_name}</td><td>${r.card_type}</td><td>${r.bank_name}</td>
            <td>${r.assigned_agent}</td>
            <td><span class="tag ${r.match_status === 'matched' ? 'matched' : r.match_status === 'outside_agent' ? 'outside' : 'duplicate'}">${r.match_status.replace('_', ' ')}</span></td>
          </tr>`).join('')}
      </tbody>
    </table>
    <button class="primary" onclick="pushMatchedToMain()">Push Matched Approvals to Main CRM</button>
  `;
}

async function pushMatchedToMain() {
  const { data } = await sb.from('approvals').select('*').eq('pushed_to_main', false).eq('match_status', 'matched');
  let sent = 0;
  for (const a of (data || [])) {
    try {
      const res = await fetch(CONFIG.MAIN_CRM_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.MAIN_CRM_PUSH_KEY },
        body: JSON.stringify({
          client_name: a.client_name, card_type: a.card_type, bank_name: a.bank_name,
          agency: a.agency, credit_limit: a.credit_limit, assigned_agent: a.assigned_agent
        })
      });
      if (res.ok) {
        await sb.from('approvals').update({ pushed_to_main: true }).eq('id', a.id);
        sent++;
      }
    } catch (e) { console.warn('Push failed', e); }
  }
  toast(`Pushed ${sent} approval(s) to main CRM.`);
}

// ---------- TAB 3: SUMMARY REPORT ----------
let currentSummaryRows = [];

async function loadSummary() {
  const agency = document.getElementById('sum-agency').value;
  let query = sb.from('approvals').select('*').order('created_at', { ascending: false });
  if (agency) query = query.eq('agency', agency);
  const { data } = await query;
  currentSummaryRows = data || [];
  const tbody = document.getElementById('summary-table');
  tbody.innerHTML = currentSummaryRows.map(a => `
    <tr>
      <td>${a.agency}</td><td>${a.client_name}</td><td>${a.card_type}</td>
      <td>${a.credit_limit}</td><td>${a.bank_name}</td><td>${a.assigned_agent}</td>
      <td><span class="tag ${a.match_status === 'matched' ? 'matched' : a.match_status === 'outside_agent' ? 'outside' : 'duplicate'}">${a.match_status.replace('_', ' ')}</span></td>
    </tr>`).join('');
}

function exportSummaryToExcel() {
  if (!currentSummaryRows.length) { toast('Nothing to export yet.'); return; }
  const rows = currentSummaryRows.map(a => ({
    'Agency': a.agency,
    'Client Name': a.client_name,
    'Card Type': a.card_type,
    'Credit Limit': a.credit_limit,
    'Bank Name': a.bank_name,
    'Assigned Agent': a.assigned_agent,
    'Status': a.match_status.replace('_', ' '),
    'Note': a.duplicate_note || ''
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Summary Report');
  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `ProCards-TeamA-Summary-${dateStr}.xlsx`);
}

// ---------- TAB 4: VOLUME REPORTS ----------
function setupDateFilter(id, onChange) {
  const wrap = document.getElementById(id);
  wrap.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const isCustom = btn.dataset.range === 'custom';
      const from = wrap.querySelector('input[id$="-from"]');
      const to = wrap.querySelector('input[id$="-to"]');
      from.style.display = isCustom ? 'inline-block' : 'none';
      to.style.display = isCustom ? 'inline-block' : 'none';
      if (!isCustom) onChange();
    });
  });
  wrap.querySelectorAll('input[type="date"]').forEach(inp => inp.addEventListener('change', onChange));
}

function setupGroupToggle(id, onChange) {
  const wrap = document.getElementById(id);
  wrap.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onChange();
    });
  });
}

function getDateRange(filterId) {
  const wrap = document.getElementById(filterId);
  const active = wrap.querySelector('button.active');
  const range = active ? active.dataset.range : 'month';
  const now = new Date();
  let from, to;
  if (range === 'today') { from = new Date(now.setHours(0,0,0,0)); to = new Date(); }
  else if (range === 'week') { from = new Date(); from.setDate(from.getDate() - from.getDay()); from.setHours(0,0,0,0); to = new Date(); }
  else if (range === 'month') { from = new Date(now.getFullYear(), now.getMonth(), 1); to = new Date(); }
  else { from = new Date(wrap.querySelector('input[id$="-from"]').value || now); to = new Date(wrap.querySelector('input[id$="-to"]').value || now); }
  return { from: from.toISOString().slice(0,10), to: to.toISOString().slice(0,10) };
}

function getActiveGroup(toggleId) {
  return document.querySelector('#' + toggleId + ' button.active').dataset.group;
}

async function loadVolume(kind) {
  if (kind === 'turnins') {
    const { from, to } = getDateRange('ti-datefilter');
    const group = getActiveGroup('ti-grouptoggle');
    const { data } = await sb.from('turn_ins').select('*').gte('date_turn_in', from).lte('date_turn_in', to);
    const rows = data || [];
    document.getElementById('ti-vol-total').textContent = rows.length;
    const counts = {};
    rows.forEach(r => {
      if (group === 'bank') (r.banks || ['—']).forEach(b => counts[b] = (counts[b]||0)+1);
      else if (group === 'agency') counts[r.agency] = (counts[r.agency]||0)+1;
      else counts[r.agent_name] = (counts[r.agent_name]||0)+1;
    });
    renderChart('chart-turnins', counts, '#c9a227');
  } else {
    const { from, to } = getDateRange('ap-datefilter');
    const group = getActiveGroup('ap-grouptoggle');
    const { data } = await sb.from('approvals').select('*').gte('created_at', from).lte('created_at', to + 'T23:59:59');
    const rows = data || [];
    document.getElementById('ap-vol-total').textContent = rows.length;
    const counts = {};
    rows.forEach(r => {
      const key = group === 'card_type' ? (r.card_type || '—') : group === 'agency' ? r.agency : r.assigned_agent;
      counts[key] = (counts[key]||0)+1;
    });
    renderChart('chart-approvals', counts, '#e4c563');
  }
}

function renderChart(canvasId, counts, color) {
  const labels = Object.keys(counts);
  const values = Object.values(counts);
  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: color }] },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#a79c88' }, grid: { color: '#3a3327' } },
        y: { ticks: { color: '#a79c88' }, grid: { color: '#3a3327' }, beginAtZero: true }
      }
    }
  });
}

// ---------- TAB 5: SETTINGS ----------
async function renderSettings() {
  await loadAgents();
  await loadAgencies();
  await loadBanks();
  await loadUbCodes();
  populateAgencyDropdowns();

  document.getElementById('settings-agents-table').innerHTML = AGENTS.map(a => `
    <tr><td>${a.name}</td><td>${a.email}</td>
    <td><button class="icon-btn danger" onclick="deleteAgent('${a.id}')">Delete</button></td></tr>`).join('');

  document.getElementById('settings-agencies-table').innerHTML = AGENCIES.map(a => `
    <tr><td>${a.name}</td>
    <td><button class="icon-btn danger" onclick="deleteAgencyRow('${a.id}')">Delete</button></td></tr>`).join('');

  const allBanks = Object.values(BANKS).flat();
  document.getElementById('banks-by-agency').innerHTML = AGENCIES.map(agency => {
    const banksForAgency = BANKS[agency.name] || [];
    return `
      <div style="margin-bottom:20px; padding-bottom:14px; border-bottom:1px solid var(--border)">
        <h4 style="margin:0 0 8px; font-size:14px; color:var(--gold-light)">${agency.name} Banks</h4>
        <div class="row-inline">
          <div><input type="text" id="bank-input-${agency.id}" placeholder="Bank name"></div>
          <div style="flex:0"><button class="secondary" onclick="addBankForAgency('${agency.id}','${agency.name}')">+ Add Bank</button></div>
        </div>
        <table><tbody>
          ${banksForAgency.map(b => `
            <tr><td>${b.bank_name}</td>
            <td><button class="icon-btn danger" onclick="deleteBank('${b.id}')">Delete</button></td></tr>`).join('')}
        </tbody></table>
      </div>`;
  }).join('') || '<p style="color:var(--text-muted); font-size:13px">Add an agency above first.</p>';

  document.getElementById('settings-ubcodes-table').innerHTML = UB_CODES.map(c => `
    <tr><td>${c.agents ? c.agents.name : ''}</td><td>${c.agent_code}</td>
    <td><button class="icon-btn danger" onclick="deleteAgentCode('${c.id}')">Delete</button></td></tr>`).join('');
}

async function addAgent() {
  const name = document.getElementById('set-agent-name').value.trim();
  const email = document.getElementById('set-agent-email').value.trim();
  if (!name || !email) { toast('Enter agent name and email.'); return; }
  await sb.from('agents').insert({ name, email });
  document.getElementById('set-agent-name').value = '';
  document.getElementById('set-agent-email').value = '';
  renderSettings();
}
async function deleteAgent(id) { await sb.from('agents').delete().eq('id', id); renderSettings(); }

async function addAgencyRow() {
  const name = document.getElementById('set-agency-name').value.trim();
  if (!name) { toast('Enter an agency name.'); return; }
  const { error } = await sb.from('agencies').insert({ name });
  if (error) { toast('Add failed: ' + error.message); return; }
  document.getElementById('set-agency-name').value = '';
  renderSettings();
}
async function deleteAgencyRow(id) { await sb.from('agencies').delete().eq('id', id); renderSettings(); }

async function addBankForAgency(agencyId, agencyName) {
  const input = document.getElementById(`bank-input-${agencyId}`);
  const name = input.value.trim();
  if (!name) { toast('Enter a bank name.'); return; }
  await sb.from('banks').insert({ agency: agencyName, bank_name: name });
  renderSettings();
}
async function deleteBank(id) { await sb.from('banks').delete().eq('id', id); renderSettings(); }

async function addAgentCode() {
  const agentId = document.getElementById('set-ub-agent').value;
  const code = document.getElementById('set-ub-code').value.trim();
  if (!agentId || !code) { toast('Select agent and enter code.'); return; }
  await sb.from('unionbank_agent_codes').insert({ agent_id: agentId, agent_code: code });
  document.getElementById('set-ub-code').value = '';
  renderSettings();
}
async function deleteAgentCode(id) { await sb.from('unionbank_agent_codes').delete().eq('id', id); renderSettings(); }
