// The one-page PM service sheet. Same layout for every submission.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { LOGO_PNG_BASE64 } from './logo.mjs';
import { splitFilter } from './records.mjs';
import { TYPES, TIME_ZONE } from './config.mjs';

const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const GREEN = hex('#004745');
const TAN = hex('#D4A070');
const INK = hex('#1E2A2A');
const MUTED = hex('#5E6B6A');
const LINE = hex('#D5DCDA');
const FAINT = hex('#F3F6F5');
const WHITE = rgb(1, 1, 1);

const W = 612, H = 792, M = 42, BOTTOM = 70;

// Standard PDF fonts only cover Western characters; swap or drop the rest.
const MAP = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', '•': '*', '×': 'x' };
export function safe(s) {
  return String(s ?? '').replace(/[^\x20-\x7E\xA0-\xFF\n]/g, (c) => MAP[c] ?? '');
}

export const title = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bAc\b/g, 'AC');
export const usDate = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : d || '');
const num = (n) => (n == null ? '-' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }));

function wrap(text, font, size, width) {
  const lines = [];
  for (const para of safe(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      let w = word;
      // break words longer than the line
      while (font.widthOfTextAtSize(w, size) > width) {
        let i = w.length - 1;
        while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
        if (line) { lines.push(line); line = ''; }
        lines.push(w.slice(0, i));
        w = w.slice(i);
      }
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = w; } else line = next;
    }
    lines.push(line);
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

function roundRect(page, x, yTop, w, h, r, opts) {
  const p = `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
  page.drawSvgPath(p, { x, y: yTop, ...opts });
}

function submittedText(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const s = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
  return `Submitted ${s.replace(',', '')}`;
}

/**
 * data: { eq, sn, date, hours, by, level, types, filters, allFilters, fluids:[[name,amount]],
 *         parts, notes, prev:{hours,date}|null, submitted }
 * Returns Uint8Array.
 */
export async function buildSheet(data) {
  const doc = await PDFDocument.create();
  doc.setTitle(safe(`PM Service ${data.eq} ${data.date}`));
  doc.setAuthor('Lyons & Hohl Site Contractors');
  doc.setCreator('Equipment PM Service app');
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ital = await doc.embedFont(StandardFonts.HelveticaOblique);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const monoB = await doc.embedFont(StandardFonts.CourierBold);
  const logo = await doc.embedPng(Buffer.from(LOGO_PNG_BASE64, 'base64'));

  let page = doc.addPage([W, H]);
  const text = (s, x, y, font, size, color = INK) => page.drawText(safe(s), { x, y, font, size, color });
  const right = (s, xr, y, font, size, color = INK) => { const t = safe(s); page.drawText(t, { x: xr - font.widthOfTextAtSize(t, size), y, font, size, color }); };
  const label = (s, x, y, color = MUTED, size = 7.5) => text(String(s).toUpperCase(), x, y, bold, size, color);

  function footer() {
    page.drawLine({ start: { x: M, y: 46 }, end: { x: W - M, y: 46 }, thickness: 1.2, color: TAN });
    text('LYONS & HOHL SITE CONTRACTORS  -  EQUIPMENT PM SERVICES', M, 34, bold, 8, GREEN);
    right('Pride In Our People. Pride In Our Work.', W - M, 34, reg, 8, MUTED);
  }
  function section(y, name) {
    const t = name.toUpperCase();
    text(t, M, y, bold, 10, GREEN);
    const x0 = M + bold.widthOfTextAtSize(safe(t), 10) + 8;
    page.drawLine({ start: { x: x0, y: y + 3.5 }, end: { x: W - M, y: y + 3.5 }, thickness: 1.2, color: TAN });
    return y - 18;
  }
  function newPage() {
    footer();
    page = doc.addPage([W, H]);
    text(`${data.eq}  -  ${usDate(data.date)}  (continued)`, M, H - M - 10, bold, 11, GREEN);
    page.drawLine({ start: { x: M, y: H - M - 20 }, end: { x: W - M, y: H - M - 20 }, thickness: 2, color: TAN });
    return H - M - 44;
  }

  // Header
  const lw = 190;
  const lh = (lw * logo.height) / logo.width;
  page.drawImage(logo, { x: M, y: H - M - lh, width: lw, height: lh });
  right('PREVENTIVE MAINTENANCE', W - M, H - M - 18, bold, 15, GREEN);
  right('SERVICE RECORD', W - M, H - M - 36, bold, 15, GREEN);
  right(submittedText(data.submitted), W - M, H - M - 52, reg, 8.5, MUTED);
  let y = H - M - lh - 14;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 3, color: TAN });

  // Machine band
  y -= 16;
  const bandH = 74;
  // Outlined in green with no fill, so it prints cleanly on black-and-white printers.
  roundRect(page, M, y, W - 2 * M, bandH, 5, { borderColor: GREEN, borderWidth: 1.5 });
  label('Equipment ID', M + 16, y - 20, GREEN);
  let eqSize = 30;
  while (bold.widthOfTextAtSize(safe(data.eq), eqSize) > 135 && eqSize > 16) eqSize -= 1;
  text(data.eq, M + 16, y - 52, bold, eqSize, GREEN);
  const x0 = M + 165;
  page.drawLine({ start: { x: x0 - 12, y: y - 12 }, end: { x: x0 - 12, y: y - bandH + 12 }, thickness: 1.5, color: TAN });
  const cols = [
    ['Serial #', data.sn || '-', monoB],
    ['Service date', usDate(data.date), bold],
    ['Hour meter', num(data.hours), bold],
    ['Mechanic', title(data.by) || '-', bold],
  ];
  const cw = (W - M - 12 - x0) / 4;
  cols.forEach(([k, v, f], i) => {
    const x = x0 + i * cw;
    label(k, x, y - 20, GREEN);
    let size = 12.5;
    while (f.widthOfTextAtSize(safe(v), size) > cw - 6 && size > 7) size -= 0.5;
    text(v, x, y - 40, f, size, INK);
  });
  let since = 'First service on record';
  if (data.prev && data.prev.hours != null && data.hours != null) {
    since = data.hours >= data.prev.hours
      ? `${num(data.hours - data.prev.hours)} hrs since previous service (${num(data.prev.hours)} hrs on ${usDate(data.prev.date)})`
      : `Hour meter is lower than the previous service (${num(data.prev.hours)} hrs on ${usDate(data.prev.date)}). Check the reading.`;
  }
  text(since, x0, y - 60, reg, 8.5, MUTED);
  y -= bandH + 26;

  // Service performed
  y = section(y, 'Service performed');
  label('Level', M, y);
  label('Type', M + 120, y);
  y -= 20;
  const pill = (x, s, fill, fg, outline, size = 9) => {
    const w = bold.widthOfTextAtSize(s, size) + 16;
    roundRect(page, x, y + 13, w, 18, 9, fill ? { color: fill } : { borderColor: outline, borderWidth: 1 });
    text(s, x + 8, y + 0.5, bold, size, fg);
    return x + w + 6;
  };
  pill(M, data.level || 'NOT SET', data.level ? TAN : null, data.level ? GREEN : MUTED, LINE, 10);
  let px = M + 120;
  for (const t of TYPES) {
    const on = (data.types || []).includes(t);
    px = pill(px, t, on ? GREEN : null, on ? WHITE : MUTED, LINE);
  }
  y -= 34;

  // Filters
  const all = data.allFilters?.length ? data.allFilters : data.filters;
  const done = new Set(data.filters || []);
  const extra = (data.filters || []).filter((f) => !all.includes(f)); // filters no longer on the list
  const list = [...all, ...extra];
  y = section(y, `Filters changed  (${done.size} of ${all.length})`);
  const colw = (W - 2 * M) / 2;
  const rows = Math.ceil(list.length / 2);
  list.forEach((f, i) => {
    const col = i < rows ? 0 : 1;
    const row = i < rows ? i : i - rows;
    const x = M + col * colw;
    const yy = y - row * 22;
    const on = done.has(f);
    if (on) {
      roundRect(page, x, yy + 8, 10, 10, 1.5, { color: GREEN });
      page.drawSvgPath('M 2.2 4.8 L 4.3 7.2 L 8 2.4', { x, y: yy + 8, borderColor: WHITE, borderWidth: 1.6 });
    } else {
      roundRect(page, x, yy + 8, 10, 10, 1.5, { borderColor: LINE, borderWidth: 1 });
    }
    const { name, part } = splitFilter(f);
    const pw = mono.widthOfTextAtSize(safe(part), 9);
    let nsize = 9.5;
    const nf = on ? bold : reg;
    while (nf.widthOfTextAtSize(safe(title(name)), nsize) > colw - 40 - pw && nsize > 6.5) nsize -= 0.5;
    text(title(name), x + 18, yy, nf, nsize, on ? INK : MUTED);
    right(part, x + colw - 16, yy, mono, 9, MUTED);
  });
  y -= rows * 22 + 12;

  // Fluids
  y = section(y, 'Fluids added');
  if (data.fluids?.length) {
    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 16, color: FAINT });
    label('Fluid', M + 10, y + 1);
    label('Amount', M + 200, y + 1);
    y -= 20;
    for (const [n, a] of data.fluids) {
      if (y < BOTTOM) y = newPage();
      text(n, M + 10, y, bold, 10.5);
      text(a, M + 200, y, reg, 10.5);
      page.drawLine({ start: { x: M, y: y - 6 }, end: { x: W - M, y: y - 6 }, thickness: 0.6, color: LINE });
      y -= 20;
    }
  } else {
    text('None recorded', M + 10, y, ital, 10, MUTED);
    y -= 18;
  }
  y -= 10;

  // Text blocks (continue onto a second page only if very long)
  function block(name, body) {
    if (y < BOTTOM + 40) y = newPage();
    y = section(y, name);
    const lines = body ? wrap(body, reg, 10, W - 2 * M - 20) : [];
    if (!lines.length) {
      roundRect(page, M, y + 10, W - 2 * M, 34, 4, { color: FAINT });
      text('None recorded', M + 10, y - 4, ital, 10, MUTED);
      y -= 40;
      return;
    }
    let i = 0;
    while (i < lines.length) {
      const room = Math.max(1, Math.floor((y + 10 - 8 - BOTTOM) / 14));
      const chunk = lines.slice(i, i + room);
      const h = chunk.length * 14 + 16;
      roundRect(page, M, y + 10, W - 2 * M, h, 4, { color: FAINT });
      let ty = y - 4;
      for (const ln of chunk) { text(ln, M + 10, ty, reg, 10); ty -= 14; }
      i += chunk.length;
      y -= h + 6;
      if (i < lines.length) y = newPage();
    }
  }
  block('Other filters / parts', data.parts);
  block('Service notes', data.notes);

  footer();
  return doc.save();
}

export function sheetFilename(eq, date) {
  return `PM Service ${String(eq).replace(/[^\w.-]+/g, '-')} ${date || 'undated'}.pdf`;
}
