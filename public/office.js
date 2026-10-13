// Office screens: sign in, all service records, the sheet, PDF download.
/* global $, esc, title, usDate, num, splitFilter, store, api */

let D = null;            // { machines, tables, mechanics, levels, types, freshMinutes, now }
const BY_TABLE = new Map();
let shown = 100;
let current = null;      // { m, r }

/* ---------- sign-in ---------- */
async function start() {
  try {
    const me = await api('/me');
    if (me.role !== 'office') { $('pinScreen').hidden = false; $('pin').focus(); return; }
    await load();
  } catch (e) { fatal(e.message); }
}
function fatal(msg) { $('loading').hidden = true; $('fatal').textContent = msg; $('fatal').hidden = false; }

$('pinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('pinErr').hidden = true;
  $('pinGo').disabled = true;
  try {
    await api('/login', { method: 'POST', body: { role: 'office', pin: $('pin').value } });
    $('pin').value = '';
    $('pinScreen').hidden = true;
    await load();
  } catch (err) {
    $('pinErr').textContent = err.message; $('pinErr').hidden = false;
  } finally { $('pinGo').disabled = false; }
});
$('signOut').onclick = async () => { try { await api('/logout', { method: 'POST' }); } catch { /* ignore */ } location.href = '/office.html'; };

/* ---------- data ---------- */
async function load() {
  $('loading').hidden = false;
  D = await api('/office/data');
  D.machines.forEach((m) => BY_TABLE.set(m.tableId, m));
  $('loading').hidden = true;
  $('signOut').hidden = false;
  $('listScreen').hidden = false;
  fillFilters();
  route();
  refresh(false);
}

let syncing = false;
async function refresh(all) {
  if (syncing) return;
  const fresh = D.freshMinutes * 60000;
  const stale = D.machines.filter((m) => all || !D.tables[m.tableId] || Date.now() - D.tables[m.tableId].at > fresh).map((m) => m.tableId);
  if (!stale.length) { setSync(''); return; }
  syncing = true;
  $('refreshAll').disabled = true;
  const first = !Object.keys(D.tables).length;
  try {
    for (let i = 0; i < stale.length; i += 6) {
      setSync(`<span class="spinner"></span> ${first ? 'Loading' : 'Checking'} machines from Airtable: ${Math.min(i + 6, stale.length)} of ${stale.length}…${first ? ' The first load takes about half a minute.' : ''}`);
      const r = await api('/office/refresh', { method: 'POST', body: { tableIds: stale.slice(i, i + 6) } });
      Object.assign(D.tables, r.tables);
      if (!current) renderList();
    }
    setSync('');
  } catch (e) {
    setSync(`${esc(e.message)} <button type="button" class="linkbtn" id="retry">Try again</button>`, true);
    const b = document.getElementById('retry'); if (b) b.onclick = () => refresh(all);
  } finally {
    syncing = false;
    $('refreshAll').disabled = false;
  }
}
function setSync(html, warn = false) {
  $('sync').hidden = !html;
  $('sync').className = `msg ${warn ? 'warn' : 'info'}`;
  $('sync').innerHTML = html;
}
$('refreshAll').onclick = () => refresh(true);

function allRecords() {
  const out = [];
  for (const m of D.machines) {
    const t = D.tables[m.tableId];
    if (!t) continue;
    t.records.forEach((r, i) => {
      const prev = t.records.slice(i + 1).find((x) => x.hours != null);
      const low = prev && r.hours != null && prev.hours != null && r.hours < prev.hours;
      out.push({ m, r, prev, low });
    });
  }
  return out.sort((a, b) => (b.r.date || '').localeCompare(a.r.date || '') || (b.r.created || '').localeCompare(a.r.created || ''));
}

/* ---------- filters ---------- */
const FKEY = 'pm-office-filters';
function fillFilters() {
  const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  $('fMach').innerHTML = opt('', 'All machines') + D.machines.map((m) => opt(m.tableId, m.id)).join('');
  $('fMech').innerHTML = opt('', 'Everyone') + D.mechanics.map((n) => opt(n, title(n))).join('');
  $('fLvl').innerHTML = opt('', 'All') + D.levels.map((l) => opt(l, title(l))).join('') + opt('none', 'No level set');
  const saved = store.get(FKEY) || {};
  for (const id of ['fMach', 'fMech', 'fLvl', 'fWhen', 'fFlag']) {
    if (saved[id] != null && [...$(id).options].some((o) => o.value === saved[id])) $(id).value = saved[id];
    $(id).onchange = () => { shown = 100; store.set(FKEY, Object.fromEntries(['fMach', 'fMech', 'fLvl', 'fWhen', 'fFlag'].map((k) => [k, $(k).value]))); renderList(); };
  }
}
function cutoff(days) {
  if (!days) return '';
  const d = new Date(Date.now() - Number(days) * 86400000);
  return d.toISOString().slice(0, 10);
}

/* ---------- list ---------- */
function renderList() {
  const fm = $('fMach').value, fe = $('fMech').value, fl = $('fLvl').value, from = cutoff($('fWhen').value), flag = $('fFlag').value;
  const rows = allRecords().filter(({ m, r, low }) =>
    (!fm || m.tableId === fm) && (!fe || r.by === fe) &&
    (!fl || (fl === 'none' ? !r.level : r.level === fl)) && (!from || (r.date || '') >= from) &&
    (!flag || (flag === 'hours' ? low : !r.pdf)));
  renderMachineSummary(fm);
  const loaded = Object.keys(D.tables).length;
  $('count').textContent = `${rows.length} record${rows.length === 1 ? '' : 's'}${loaded < D.machines.length ? ` so far (${loaded} of ${D.machines.length} machines loaded)` : ''}`;
  const list = $('list'); list.innerHTML = '';
  if (!rows.length) list.innerHTML = `<div class="sub" style="padding:14px 4px">${loaded ? 'No records match these filters. Try a longer period.' : ''}</div>`;
  rows.slice(0, shown).forEach(({ m, r, low }) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'item';
    b.innerHTML = `<span class="d">${esc(usDate(r.date) || 'No date')}</span><span class="eq">${esc(m.id)}</span>
      <span class="meta">${num(r.hours)} hrs · ${esc(title(r.by) || 'No name')}<span>${r.types.length ? ` · ${esc(r.types.join(', '))}` : ''}${r.filters.length ? ` · ${r.filters.length} filter${r.filters.length === 1 ? '' : 's'}` : ''}</span></span>
      <span class="tags">${r.level ? `<span class="tag lvl">${esc(title(r.level))}</span>` : ''}${low ? '<span class="tag flag">Check hours</span>' : ''}${r.pdf ? '<span class="tag pdf">PDF saved</span>' : '<span class="tag nopdf">No PDF</span>'}</span>`;
    b.onclick = () => openDetail(m.tableId, r.id, true);
    list.append(b);
  });
  $('more').hidden = rows.length <= shown;
}
$('more').onclick = () => { shown += 100; renderList(); };

function renderMachineSummary(tableId) {
  const box = $('machineSummary');
  if (!tableId) { box.innerHTML = ''; return; }
  const m = BY_TABLE.get(tableId);
  const t = D.tables[tableId];
  if (!t) { box.innerHTML = `<div class="msg info"><span class="spinner"></span> Loading ${esc(m.id)}…</div>`; return; }
  const recs = t.records;
  const last = recs.find((r) => r.hours != null);
  const lv = (l) => { const r = recs.find((x) => x.level === l); return r ? `${num(r.hours)} hrs<div class="s">${esc(usDate(r.date))}</div>` : '<span class="s">None on record</span>'; };
  box.innerHTML = `<div class="mstats">
    <div><div class="label">${esc(m.id)} · SN</div><div class="v" style="font-family:var(--mono)">${esc(m.sn || '-')}</div><div class="s">${recs.length} services on record</div></div>
    <div><div class="label">Last service</div><div class="v">${last ? `${num(last.hours)} hrs` : '-'}</div><div class="s">${last ? `${esc(usDate(last.date))} · ${esc(title(last.by))}` : ''}</div></div>
    <div><div class="label">Last Service 1</div><div class="v">${lv('SERVICE 1')}</div></div>
    <div><div class="label">Last Service 2 / 3</div><div class="v">${lv('SERVICE 2')}</div><div class="v" style="margin-top:4px">${lv('SERVICE 3')}</div></div>
  </div>`;
}

/* ---------- detail ---------- */
function openDetail(tableId, recId, push) {
  const m = BY_TABLE.get(tableId);
  const t = D.tables[tableId];
  const i = t ? t.records.findIndex((x) => x.id === recId) : -1;
  if (!m || i < 0) { closeDetail(false); return; }
  const r = t.records[i];
  const prev = t.records.slice(i + 1).find((x) => x.hours != null) || null;
  current = { m, r };
  if (push) history.pushState({ rec: [tableId, recId] }, '', `#${tableId}.${recId}`);
  $('listScreen').hidden = true;
  $('detailScreen').hidden = false;
  $('detailMsg').hidden = true;
  $('sheet').innerHTML = sheetHTML(m, r, prev);
  const q = `t=${encodeURIComponent(tableId)}&r=${encodeURIComponent(recId)}`;
  $('dl').href = `/api/office/pdf?${q}`;
  $('view').href = `/api/office/pdf?${q}&view=1`;
  $('attach').hidden = r.pdf;
  window.scrollTo(0, 0);
}
function closeDetail(push) {
  current = null;
  if (push) history.pushState({}, '', location.pathname);
  $('detailScreen').hidden = true;
  $('listScreen').hidden = false;
  renderList();
}
$('back').onclick = () => (history.state?.rec ? history.back() : closeDetail(true));
window.addEventListener('popstate', route);
function route() {
  const m = /^#(tbl\w+)\.(rec\w+)$/.exec(location.hash);
  if (m && D.tables[m[1]]) openDetail(m[1], m[2], false);
  else closeDetail(false);
}

$('attach').onclick = async () => {
  if (!current) return;
  const b = $('attach');
  b.disabled = true; b.textContent = 'Attaching…';
  try {
    await api('/office/attach', { method: 'POST', body: { tableId: current.m.tableId, recordId: current.r.id } });
    current.r.pdf = true;
    b.hidden = true;
    $('detailMsg').className = 'msg ok'; $('detailMsg').textContent = 'The PDF sheet is now attached to this record in Airtable.'; $('detailMsg').hidden = false;
  } catch (e) {
    $('detailMsg').className = 'msg warn'; $('detailMsg').textContent = e.message; $('detailMsg').hidden = false;
  } finally { b.disabled = false; b.textContent = 'Attach PDF to Airtable'; }
};

function sheetHTML(m, r, prev) {
  let since = 'First service on record';
  if (prev && prev.hours != null && r.hours != null) {
    since = r.hours >= prev.hours
      ? `${num(r.hours - prev.hours)} hrs since previous service (${num(prev.hours)} hrs on ${usDate(prev.date)})`
      : `Hour meter is lower than the previous service (${num(prev.hours)} hrs on ${usDate(prev.date)}). Check the reading.`;
  }
  const all = m.filters.slice();
  r.filters.forEach((f) => { if (!all.includes(f)) all.push(f); });
  const rowsN = Math.ceil(all.length / 2);
  const flt = all.map((f) => { const s = splitFilter(f); const on = r.filters.includes(f); return `<div class="${on ? 'on' : ''}"><i></i><span>${esc(title(s.name))}</span><span>${esc(s.part)}</span></div>`; }).join('');
  const fl = r.fluids.length
    ? `<table class="sh-fl"><tr><th>Fluid</th><th>Amount</th></tr>${r.fluids.map(([f, a]) => `<tr><td>${esc(f)}</td><td>${esc(a)}</td></tr>`).join('')}</table>`
    : '<div class="sh-none">None recorded</div>';
  const box = (t) => (t ? `<div class="sh-box">${esc(t)}</div>` : '<div class="sh-box sh-none">None recorded</div>');
  const sub = r.created ? `Submitted ${new Date(r.created).toLocaleString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(',', '')}` : '';
  return `<div class="sh-head"><img src="/logo.png" alt="Lyons &amp; Hohl Site Contractors"><div class="t">PREVENTIVE MAINTENANCE<br>SERVICE RECORD<small>${esc(sub)}</small></div></div>
  <div class="sh-band"><div><div class="k">Equipment ID</div><div class="big">${esc(m.id)}</div></div>
    <div><div class="k">Serial #</div><div class="v mono">${esc(m.sn || '-')}</div></div><div><div class="k">Service date</div><div class="v">${esc(usDate(r.date))}</div></div>
    <div><div class="k">Hour meter</div><div class="v">${num(r.hours)}</div></div><div><div class="k">Mechanic</div><div class="v">${esc(title(r.by) || '-')}</div></div>
    <div class="since">${esc(since)}</div></div>
  <div class="sh-sec">Service performed</div>
  <div class="sh-svc"><div><div class="k">Level</div><span class="sp ${r.level ? 'lv' : ''}">${esc(r.level || 'NOT SET')}</span></div>
    <div><div class="k">Type</div>${D.types.map((t) => `<span class="sp ${r.types.includes(t) ? 'on' : ''}">${t}</span>`).join('')}</div></div>
  <div class="sh-sec">Filters changed (${r.filters.length} of ${m.filters.length})</div>
  <div class="sh-flt" style="grid-template-rows:repeat(${rowsN},auto)">${flt}</div>
  <div class="sh-sec">Fluids added</div>${fl}
  <div class="sh-sec">Other filters / parts</div>${box(r.parts)}
  <div class="sh-sec">Service notes</div>${box(r.notes)}
  <div class="sh-foot"><b>LYONS &amp; HOHL SITE CONTRACTORS · EQUIPMENT PM SERVICES</b><span>Pride In Our People. Pride In Our Work.</span></div>`;
}

start();
