// Helpers shared by the mechanic and office pages.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const title = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bAc\b/g, 'AC');
const usDate = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : d || '');
const num = (n) => (n == null ? '-' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }));
const idKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function splitFilter(label) {
  const m = /^(.+?)\s+-\s*(\S.*)$/.exec(label);
  return m ? { name: m[1].trim(), part: m[2].trim() } : { name: String(label).trim(), part: '' };
}
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

class ApiError extends Error {
  constructor(message, status, offline = false) { super(message); this.status = status; this.offline = offline; }
}

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('No connection. Check your signal and try again.', 0, true);
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError(data?.error || `Something went wrong (${res.status}).`, res.status);
  return data;
}

/** Number pad for the mechanic PIN. onDone(pin) returns a promise; reject = wrong. */
function buildPinPad({ pad, dots, err, length = 4, onDone }) {
  let pin = '';
  let busy = false;
  const show = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < pin.length));
  async function press(k) {
    if (busy) return;
    err.hidden = true;
    if (k === 'Clear') pin = '';
    else if (k === 'Back') pin = pin.slice(0, -1);
    else if (pin.length < length) pin += k;
    show();
    if (pin.length === length) {
      busy = true;
      try { await onDone(pin); } catch (e) { err.textContent = e.message; err.hidden = false; }
      pin = '';
      busy = false;
      setTimeout(show, 200);
    }
  }
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', 'Back'].forEach((k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = k;
    if (k.length > 1) b.className = 'fn';
    b.setAttribute('aria-label', k === 'Back' ? 'Delete last digit' : k);
    b.onclick = () => press(k);
    pad.append(b);
  });
  document.addEventListener('keydown', (e) => {
    if (pad.closest('[hidden]')) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('Back');
  });
}

function chip(text, pressed, onClick, cls = 'chip') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  b.onclick = onClick;
  return b;
}

/** History list items (used on the mechanic history tab). */
function historyCard(r, prev, open) {
  const low = prev && prev.hours != null && r.hours != null && r.hours < prev.hours;
  const d = document.createElement('details');
  d.className = 'hcard';
  d.open = !!open;
  const flt = r.filters.length
    ? `<ul>${r.filters.map((f) => { const s = splitFilter(f); return `<li>${esc(title(s.name))} <span class="pn">${esc(s.part)}</span></li>`; }).join('')}</ul>`
    : 'None';
  const since = prev && !low && r.hours != null && prev.hours != null ? ` · +${num(r.hours - prev.hours)} hrs` : '';
  d.innerHTML = `<summary><span class="d">${esc(usDate(r.date) || 'No date')} · ${num(r.hours)} hrs</span>
    <span class="tags">${r.level ? `<span class="tag lvl">${esc(title(r.level))}</span>` : ''}${low ? '<span class="tag flag">Check hours</span>' : ''}</span>
    <span class="meta">${esc(title(r.by) || 'No name')}${r.types.length ? ` · ${esc(r.types.join(', '))}` : ''}${since}</span></summary>
    <div class="hbody">
      <div><div class="label">Filters changed (${r.filters.length})</div>${flt}</div>
      <div><div class="label">Fluids added</div>${r.fluids.length ? r.fluids.map(([f, a]) => `${esc(f)}: ${esc(a)}`).join('<br>') : 'None'}</div>
      ${r.parts ? `<div><div class="label">Other filters / parts</div><div class="txt">${esc(r.parts)}</div></div>` : ''}
      ${r.notes ? `<div><div class="label">Service notes</div><div class="txt">${esc(r.notes)}</div></div>` : ''}
    </div>`;
  return d;
}
