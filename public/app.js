// Mechanic screens: sign in, log a service, machine history.
/* global $, esc, title, usDate, num, idKey, splitFilter, store, api, buildPinPad, chip, historyCard */

let SETUP = null;           // mechanics, machines, fluids, units, today
const MACHINE = new Map();  // equipment ID -> { id, sn, filters, records }
const S = {                 // the form being filled in (also kept on the phone as a draft)
  mech: null, eq: null, date: '', hours: '', level: null, types: [], filters: [], fluids: [], parts: '', notes: '', clientId: null,
};
const DRAFT = 'pm-draft';
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

/* ---------------- start ---------------- */
async function start() {
  try {
    const me = await api('/me');
    if (!me.role) return showPin();
    await loadApp();
  } catch (e) {
    showFatal(e.message);
  }
}
function showFatal(msg) {
  $('loading').hidden = true;
  $('fatal').textContent = msg;
  $('fatal').hidden = false;
}
function showPin() {
  $('loading').hidden = true;
  $('pinScreen').hidden = false;
  $('app').hidden = true;
  $('foot').hidden = true;
}
buildPinPad({
  pad: $('pad'), dots: $('dots'), err: $('pinErr'),
  onDone: async (pin) => {
    await api('/login', { method: 'POST', body: { role: 'mech', pin } });
    $('pinScreen').hidden = true;
    $('loading').hidden = false;
    await loadApp();
  },
});

async function loadApp() {
  SETUP = await api('/setup');
  $('loading').hidden = true;
  $('fatal').hidden = true;
  $('app').hidden = false;
  $('foot').hidden = false;
  restoreDraft();
  renderAll();
  if (S.eq) pickMachine(S.eq, { keep: true });
}

$('signOut').onclick = async () => {
  try { await api('/logout', { method: 'POST' }); } catch { /* ignore */ }
  location.reload();
};

/* ---------------- tabs ---------------- */
function tab(t) {
  $('tabLog').setAttribute('aria-selected', t === 'log');
  $('tabHist').setAttribute('aria-selected', t === 'hist');
  $('logPane').hidden = t !== 'log';
  $('histPane').hidden = t !== 'hist';
  window.scrollTo(0, 0);
}
$('tabLog').onclick = () => tab('log');
$('tabHist').onclick = () => { tab('hist'); renderHistory(); };

/* ---------------- draft ---------------- */
function saveDraft() {
  S.date = $('date').value;
  S.hours = $('hours').value;
  S.parts = $('parts').value;
  S.notes = $('notes').value;
  store.set(DRAFT, { ...S, mech: undefined });
}
function restoreDraft() {
  const d = store.get(DRAFT);
  const mech = store.get('pm-mech');
  if (SETUP.mechanics.includes(mech)) S.mech = mech;
  if (d && typeof d === 'object') {
    Object.assign(S, { ...d, mech: S.mech });
  }
  if (!S.clientId) S.clientId = newId();
  $('date').value = S.date || SETUP.today;
  $('date').max = SETUP.today;
  $('hours').value = S.hours || '';
  $('parts').value = S.parts || '';
  $('notes').value = S.notes || '';
  $('eqid').value = S.eq || '';
}
function clearDraft() {
  store.del(DRAFT);
  Object.assign(S, { eq: null, date: SETUP.today, hours: '', level: null, types: [], filters: [], fluids: [], parts: '', notes: '', clientId: newId() });
  ['eqid', 'hours', 'parts', 'notes'].forEach((id) => { $(id).value = ''; });
  $('date').value = SETUP.today;
}
['date', 'hours', 'parts', 'notes'].forEach((id) => $(id).addEventListener('input', () => { saveDraft(); if (id === 'hours') checkHours(); check(); }));

/* ---------------- form ---------------- */
function renderAll() {
  renderMechanics(); renderLevel(); renderTypes(); renderFluids(); renderSuggest(); renderMachine(); renderFilters(); checkHours(); check();
}
function renderMechanics() {
  const box = $('mechanics'); box.innerHTML = '';
  SETUP.mechanics.forEach((n) => box.append(chip(title(n), S.mech === n, () => {
    S.mech = n; store.set('pm-mech', n); $('who').textContent = title(n); renderMechanics(); check();
  })));
  $('who').textContent = S.mech ? title(S.mech) : '';
}
function renderLevel() {
  const box = $('level'); box.innerHTML = '';
  SETUP.levels.forEach((l) => box.append(chip(title(l), S.level === l, () => { S.level = S.level === l ? null : l; saveDraft(); renderLevel(); check(); })));
}
function renderTypes() {
  const box = $('stype'); box.innerHTML = '';
  SETUP.types.forEach((t) => box.append(chip(t, S.types.includes(t), () => {
    S.types = S.types.includes(t) ? S.types.filter((x) => x !== t) : [...S.types, t]; saveDraft(); renderTypes(); check();
  })));
}

function matchMachines(q) {
  const k = idKey(q);
  return SETUP.machines.filter((m) => !k || idKey(m.id).includes(k));
}
function exactMachine(q) {
  const k = idKey(q);
  return k ? SETUP.machines.find((m) => idKey(m.id) === k) : null;
}
function renderSuggest() {
  const box = $('suggest'); box.innerHTML = '';
  if (S.eq) return;
  const q = $('eqid').value;
  const list = matchMachines(q);
  if (!q) { box.innerHTML = '<span class="sub">Type the number on the machine.</span>'; return; }
  list.slice(0, 12).forEach((m) => box.append(chip(m.id, false, () => { $('eqid').value = m.id; pickMachine(m.id); })));
  if (list.length > 12) box.insertAdjacentHTML('beforeend', `<span class="sub">+${list.length - 12} more, keep typing</span>`);
}
$('eqid').addEventListener('input', () => {
  const m = exactMachine($('eqid').value);
  if (m) { pickMachine(m.id); return; }
  if (S.eq) { S.eq = null; S.filters = []; }
  saveDraft(); renderSuggest(); renderMachine(); renderFilters(); checkHours(); check();
});

let loadingEq = null;
async function pickMachine(id, { keep = false } = {}) {
  if (!keep && S.eq !== id) S.filters = [];
  S.eq = id;
  saveDraft();
  renderSuggest();
  if (!MACHINE.has(id)) {
    loadingEq = id;
    $('machineBox').innerHTML = '<div class="msg info"><span class="spinner"></span> Looking up ' + esc(id) + '…</div>';
    try {
      MACHINE.set(id, await api(`/machine?id=${encodeURIComponent(id)}`));
    } catch (e) {
      if (loadingEq === id) $('machineBox').innerHTML = `<div class="notfound">${esc(e.message)}</div>`;
      return;
    }
  }
  if (S.eq !== id) return;
  const m = MACHINE.get(id);
  S.filters = S.filters.filter((f) => m.filters.includes(f));
  renderMachine(); renderFilters(); checkHours(); check();
}

function lastByLevel(records) {
  return SETUP.levels.map((l) => {
    const r = records.find((x) => x.level === l);
    return `${title(l)}: ${r ? `${num(r.hours)} hrs (${usDate(r.date)})` : 'none on record'}`;
  }).join('<br>');
}
function bandHTML(m, extra = '') {
  const l = m.records[0];
  const last = l ? `Last service: <strong>${num(l.hours)} hrs</strong> on ${esc(usDate(l.date))} by ${esc(title(l.by))}<br>${lastByLevel(m.records)}` : 'No services logged yet';
  return `<div class="band"><div><div class="k">Equipment ID</div><div class="eq">${esc(m.id)}</div></div>
    <div><div class="k">Serial #</div><div class="sn">${esc(m.sn || '-')}</div></div>
    <div class="last">${last}${extra}</div></div>`;
}
function renderMachine() {
  const box = $('machineBox');
  const q = $('eqid').value.trim();
  $('rest').classList.toggle('dim', !S.eq || !MACHINE.has(S.eq));
  if (S.eq && MACHINE.has(S.eq)) {
    box.innerHTML = bandHTML(MACHINE.get(S.eq)) + `<div style="text-align:right;margin-top:6px"><button type="button" class="linkbtn" id="toHist">See full history for ${esc(S.eq)}</button></div>`;
    $('toHist').onclick = () => { $('hEq').value = S.eq; tab('hist'); renderHistory(); };
  } else if (S.eq) {
    /* loading */
  } else if (q && !matchMachines(q).length) {
    box.innerHTML = `<div class="notfound">No machine with ID <strong>${esc(q.toUpperCase())}</strong>. Check the number on the machine.</div>`;
  } else box.innerHTML = '';
}

function renderFilters() {
  const box = $('filters'); box.innerHTML = '';
  if (!S.eq || !MACHINE.has(S.eq)) { box.innerHTML = '<div class="sub">Enter an equipment ID to see its filters.</div>'; return; }
  MACHINE.get(S.eq).filters.forEach((f, i) => {
    const { name, part } = splitFilter(f);
    const l = document.createElement('label');
    l.className = 'check';
    l.innerHTML = `<input type="checkbox" id="flt${i}"><span class="nm">${esc(title(name))}${part ? `<div class="pn">${esc(part)}</div>` : ''}</span>`;
    const cb = l.querySelector('input');
    cb.checked = S.filters.includes(f);
    cb.onchange = () => { S.filters = cb.checked ? [...S.filters, f] : S.filters.filter((x) => x !== f); saveDraft(); allLabel(); };
    box.append(l);
  });
  allLabel();
}
function allLabel() {
  const m = MACHINE.get(S.eq);
  $('allFilters').textContent = m && m.filters.length && m.filters.every((f) => S.filters.includes(f)) ? 'Clear all' : 'Select all';
}
$('allFilters').onclick = () => {
  const m = MACHINE.get(S.eq); if (!m) return;
  S.filters = m.filters.every((f) => S.filters.includes(f)) ? [] : m.filters.slice();
  saveDraft(); renderFilters();
};

function renderFluids() {
  const pick = $('fluidPick'); pick.innerHTML = '';
  SETUP.fluids.filter((f) => !S.fluids.some((x) => x.name === f)).forEach((f) => pick.append(chip(`+ ${f}`, false, () => {
    S.fluids.push({ name: f, qty: '', unit: f === 'GREASE' ? 'TUBE' : 'GAL', desc: '' });
    saveDraft(); renderFluids();
    const inp = document.getElementById(`fq-${f.replace(/\s/g, '_')}`); if (inp) inp.focus();
  })));
  const rows = $('fluidRows'); rows.innerHTML = '';
  S.fluids.forEach((v) => {
    const r = document.createElement('div');
    r.className = 'fl';
    const id = v.name.replace(/\s/g, '_');
    r.innerHTML = `<span class="n">${esc(v.name)}</span>
      <input type="number" inputmode="decimal" step="0.25" min="0" id="fq-${id}" placeholder="Qty" aria-label="${esc(v.name)} amount">
      <select id="fu-${id}" aria-label="${esc(v.name)} unit">${SETUP.units.map((u) => `<option${u === v.unit ? ' selected' : ''}>${u}</option>`).join('')}</select>
      <button type="button" class="x" aria-label="Remove ${esc(v.name)}">×</button>
      ${v.name === 'OTHER' ? `<input type="text" class="desc" id="fd-${id}" placeholder="What fluid? e.g. DEF" aria-label="Other fluid name" maxlength="60">` : ''}`;
    const q = r.querySelector('input[type=number]'); q.value = v.qty;
    q.oninput = () => { v.qty = q.value; saveDraft(); check(); };
    r.querySelector('select').onchange = (e) => { v.unit = e.target.value; saveDraft(); };
    const d = r.querySelector('.desc'); if (d) { d.value = v.desc || ''; d.oninput = () => { v.desc = d.value; saveDraft(); check(); }; }
    r.querySelector('.x').onclick = () => { S.fluids = S.fluids.filter((x) => x !== v); saveDraft(); renderFluids(); check(); };
    rows.append(r);
  });
}

function checkHours() {
  const box = $('hoursMsg'); box.innerHTML = '';
  const h = parseFloat($('hours').value);
  const m = MACHINE.get(S.eq);
  if (!m || Number.isNaN(h)) return;
  const l = m.records.find((r) => r.hours != null);
  if (!l) return;
  if (h < l.hours) box.innerHTML = `<div class="msg warn">That's less than the last service (${num(l.hours)} hrs on ${esc(usDate(l.date))}). Double-check the hour meter.</div>`;
  else box.innerHTML = `<div class="msg ok">${num(h - l.hours)} hrs since the last service.</div>`;
}

function missingList() {
  const miss = [];
  if (!S.mech) miss.push('mechanic');
  if (!S.eq || !MACHINE.has(S.eq)) miss.push('equipment ID');
  if (!$('date').value) miss.push('date');
  if ($('hours').value === '') miss.push('hours');
  if (!S.level && !S.types.length) miss.push('service');
  if (S.fluids.some((f) => !(parseFloat(f.qty) > 0))) miss.push('fluid amounts');
  if (S.fluids.some((f) => f.name === 'OTHER' && !f.desc.trim())) miss.push('which "other" fluid');
  return miss;
}
function check() {
  const miss = missingList();
  $('toReview').disabled = miss.length > 0;
  $('missing').textContent = miss.length ? `Still needed: ${miss.join(', ')}` : '';
}

/* ---------------- review & send ---------------- */
function payload() {
  saveDraft();
  return {
    clientId: S.clientId, eq: S.eq, mechanic: S.mech, date: S.date, hours: S.hours, level: S.level || '',
    types: S.types, filters: S.filters, fluids: S.fluids.map((f) => ({ name: f.name, qty: f.qty, unit: f.unit, desc: f.desc })),
    parts: S.parts, notes: S.notes,
  };
}
$('toReview').onclick = () => {
  const p = payload();
  const m = MACHINE.get(p.eq);
  const rows = [
    ['Equipment', `${p.eq}  ·  SN ${m.sn || '-'}`],
    ['Mechanic', title(p.mechanic)],
    ['Date', usDate(p.date)],
    ['Hour meter', num(Number(p.hours))],
    ['Service', p.level ? title(p.level) : '-'],
    ['Service type', p.types.join(', ') || '-'],
    ['Filters changed', p.filters.map((f) => { const s = splitFilter(f); return `${title(s.name)}  ${s.part}`; }).join('\n') || 'None'],
    ['Fluids added', p.fluids.map((f) => `${f.name}: ${f.qty} ${f.unit}${f.desc ? ` ${f.desc}` : ''}`).join('\n') || 'None'],
    ['Other filters / parts', p.parts || '-'],
    ['Notes', p.notes || '-'],
  ];
  const t = $('revRows'); t.innerHTML = '';
  rows.forEach(([k, v]) => { const tr = t.insertRow(); tr.insertCell().textContent = k; tr.insertCell().textContent = v; });
  $('sendErr').hidden = true;
  $('form').hidden = true; $('review').hidden = false; window.scrollTo(0, 0);
};
$('edit').onclick = () => { $('review').hidden = true; $('form').hidden = false; };

let lastSavedEq = null;
$('send').onclick = async () => {
  const btn = $('send');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
  $('sendErr').hidden = true;
  try {
    const p = payload();
    const r = await api('/service', { method: 'POST', body: p });
    lastSavedEq = r.eq;
    MACHINE.delete(r.eq); // history reloads with the new record
    $('doneTxt').textContent = `${r.eq} service at ${num(r.hours)} hrs is saved to Airtable${r.pdfSaved ? ' with its PDF sheet attached' : ''}.`;
    $('doneWarn').hidden = !r.pdfError;
    $('doneWarn').textContent = r.pdfError || '';
    clearDraft();
    renderAll();
    $('review').hidden = true; $('done').hidden = false; window.scrollTo(0, 0);
  } catch (e) {
    $('sendErr').textContent = e.offline
      ? 'No connection. Your entry is kept on this phone. Tap Submit again when you have signal.'
      : e.message;
    $('sendErr').hidden = false;
    if (e.status === 401) setTimeout(() => location.reload(), 1500);
  } finally {
    btn.disabled = false; btn.textContent = 'Submit';
  }
};
$('another').onclick = () => { $('done').hidden = true; $('form').hidden = false; window.scrollTo(0, 0); };
$('doneHist').onclick = () => { $('done').hidden = true; $('form').hidden = false; $('hEq').value = lastSavedEq || ''; tab('hist'); renderHistory(); };

/* ---------------- history ---------------- */
let histFor = null;
$('hEq').addEventListener('input', renderHistory);
async function renderHistory() {
  const q = $('hEq').value;
  const exact = exactMachine(q);
  const sug = $('hSuggest'); const out = $('hOut');
  sug.innerHTML = '';
  if (!exact) {
    histFor = null;
    out.innerHTML = '';
    const list = matchMachines(q);
    if (!q) sug.innerHTML = '<span class="sub">Type the number on the machine.</span>';
    list.slice(0, 12).forEach((m) => sug.append(chip(m.id, false, () => { $('hEq').value = m.id; renderHistory(); })));
    if (q && !list.length) out.innerHTML = `<div class="notfound">No machine with ID <strong>${esc(q.toUpperCase())}</strong>.</div>`;
    return;
  }
  const id = exact.id;
  if (histFor === id && out.childElementCount) return;
  histFor = id;
  if (!MACHINE.has(id)) {
    out.innerHTML = `<div class="msg info"><span class="spinner"></span> Loading ${esc(id)}…</div>`;
    try { MACHINE.set(id, await api(`/machine?id=${encodeURIComponent(id)}`)); } catch (e) { out.innerHTML = `<div class="notfound">${esc(e.message)}</div>`; return; }
    if (histFor !== id) return;
  }
  const m = MACHINE.get(id);
  out.innerHTML = bandHTML(m, `<br>${m.records.length} service${m.records.length === 1 ? '' : 's'} on record`);
  const prevOf = (i) => m.records.slice(i + 1).find((r) => r.hours != null);
  m.records.forEach((r, i) => out.append(historyCard(r, prevOf(i), i === 0)));
}

start();
