// Turning Airtable tables and records into what the app shows, and checking
// what a mechanic submits before it is written.
import { F, FLUIDS, UNITS, MECHANICS, LEVELS, TYPES, TIME_ZONE } from './config.mjs';

/** Machines from the base schema. Any table with an EQUIPMENT ID field counts. */
export function machinesFromTables(tables) {
  const out = [];
  for (const t of tables) {
    const byName = new Map(t.fields.map((f) => [f.name, f]));
    if (!byName.has(F.equipment)) continue;
    const serial = byName.get(F.serial);
    const filters = byName.get(F.filters);
    out.push({
      id: t.name.trim(),
      tableId: t.id,
      sn: serial?.options?.choices?.[0]?.name || '',
      filters: (filters?.options?.choices || []).map((c) => c.name),
      sheetFieldId: byName.get(F.sheet)?.id || null,
      hasLevel: byName.has(F.level),
      fluids: FLUIDS.filter((n) => byName.has(n)),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

/** "PRIMARY AIR - 4969841" -> { name: "PRIMARY AIR", part: "4969841" } */
export function splitFilter(label) {
  const m = /^(.+?)\s+-\s*(\S.*)$/.exec(label);
  return m ? { name: m[1].trim(), part: m[2].trim() } : { name: label.trim(), part: '' };
}

/** Normalised key for matching what someone types to an equipment ID. */
export const idKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function findMachine(machines, typed) {
  const k = idKey(typed);
  if (!k) return null;
  return machines.find((m) => idKey(m.id) === k) || null;
}

// Older records typed "SERVICE 1" into the notes; read that as the level.
function guessLevel(...texts) {
  for (const t of texts) {
    const m = /SERVICE\s*#?\s*([123])\b/i.exec(t || '');
    if (m) return `SERVICE ${m[1]}`;
  }
  return '';
}

/** One service record, in the shape the screens and the PDF use. */
export function summarize(rec) {
  const f = rec.fields || {};
  const level = f[F.level] || guessLevel(f[F.notes], f[F.parts]);
  return {
    id: rec.id,
    date: f[F.date] || '',
    hours: typeof f[F.hours] === 'number' ? f[F.hours] : null,
    by: f[F.employee] || '',
    level,
    levelFromNotes: !f[F.level] && !!level,
    types: f[F.types] || [],
    filters: f[F.filters] || [],
    fluids: FLUIDS.filter((n) => f[n] && String(f[n]).trim()).map((n) => [n, String(f[n]).trim()]),
    parts: (f[F.parts] || '').trim(),
    notes: (f[F.notes] || '').trim(),
    pdf: Array.isArray(f[F.sheet]) && f[F.sheet].length > 0,
    created: rec.createdTime || '',
  };
}

/** Newest first: by service date, then hours, then when it was entered. */
export function sortRecords(list) {
  return list.slice().sort((a, b) =>
    (b.date || b.created.slice(0, 10)).localeCompare(a.date || a.created.slice(0, 10)) ||
    (b.hours ?? -1) - (a.hours ?? -1) ||
    b.created.localeCompare(a.created));
}

/** The service before this one on the same machine (records sorted newest first). */
export function previousOf(sorted, id) {
  const i = sorted.findIndex((r) => r.id === id);
  if (i < 0) return null;
  return sorted.slice(i + 1).find((r) => r.hours != null) || null;
}

export function todayLocal(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return p; // YYYY-MM-DD
}

const clean = (s, max) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').trim().slice(0, max);

/**
 * Check a submission. Returns { errors: [...] } or { value, fields } where
 * fields is ready to send to Airtable.
 */
export function validateSubmission(body, machine, now = new Date()) {
  const errors = [];
  const b = body || {};

  const mechanic = String(b.mechanic || '').toUpperCase();
  if (!MECHANICS.includes(mechanic)) errors.push('Pick who did the service.');

  const date = String(b.date || '');
  const today = todayLocal(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) errors.push('Enter the service date.');
  else if (date > today) errors.push("The date can't be in the future.");
  else if (date < '2000-01-01') errors.push('Check the date.');

  const hours = Number(b.hours);
  if (b.hours === '' || b.hours == null || !Number.isFinite(hours) || hours < 0 || hours > 200000) errors.push('Enter the hour meter reading.');

  const level = b.level ? String(b.level).toUpperCase() : '';
  if (level && !LEVELS.includes(level)) errors.push('Pick Service 1, 2 or 3.');
  const types = Array.isArray(b.types) ? [...new Set(b.types.map((t) => String(t).toUpperCase()))] : [];
  if (types.some((t) => !TYPES.includes(t))) errors.push('Unknown service type.');
  if (!level && !types.length) errors.push('Pick the service (Service 1, 2 or 3, or Air/Oil/Fuel/Hyd).');

  const filters = Array.isArray(b.filters) ? [...new Set(b.filters.map(String))] : [];
  if (filters.some((x) => !machine.filters.includes(x))) errors.push("One of the filters isn't on this machine's list. Reload and try again.");

  const fluids = [];
  for (const fl of Array.isArray(b.fluids) ? b.fluids : []) {
    const name = String(fl?.name || '').toUpperCase();
    if (!FLUIDS.includes(name)) { errors.push(`Unknown fluid: ${name || 'blank'}.`); continue; }
    const qty = Number(fl.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 10000) { errors.push(`Enter how much ${name} was added.`); continue; }
    const unit = String(fl.unit || '').toUpperCase();
    if (!UNITS.includes(unit)) { errors.push(`Pick a unit for ${name}.`); continue; }
    const desc = name === 'OTHER' ? clean(fl.desc, 60) : '';
    if (name === 'OTHER' && !desc) { errors.push('Say what the "Other" fluid was.'); continue; }
    if (fluids.some((x) => x[0] === name)) { errors.push(`${name} is listed twice.`); continue; }
    fluids.push([name, `${+qty.toFixed(2)} ${unit}${desc ? ` ${desc}` : ''}`]);
  }

  const parts = clean(b.parts, 2000);
  const notes = clean(b.notes, 4000);

  if (errors.length) return { errors };

  const fields = {
    [F.equipment]: machine.id,
    [F.hours]: hours,
    [F.date]: date,
    [F.employee]: mechanic,
  };
  if (machine.sn) fields[F.serial] = machine.sn;
  if (level && machine.hasLevel) fields[F.level] = level;
  if (types.length) fields[F.types] = types;
  if (filters.length) fields[F.filters] = filters;
  for (const [n, v] of fluids) fields[n] = v;
  if (parts) fields[F.parts] = parts;
  // A table without the SERVICE LEVEL field keeps the level in the notes, as before.
  const notesOut = level && !machine.hasLevel ? [level, notes].filter(Boolean).join(' - ') : notes;
  if (notesOut) fields[F.notes] = notesOut;

  return { value: { mechanic, date, hours, level, types, filters, fluids, parts, notes }, fields };
}
