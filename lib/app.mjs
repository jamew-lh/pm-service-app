// All /api/* routes. Kept apart from the Netlify wrapper so tests can run it
// against a fake Airtable.
import { MECHANICS, PAST_MECHANICS, LEVELS, TYPES, FLUIDS, UNITS, CACHE_FRESH_MINUTES } from './config.mjs';
import { machinesFromTables, findMachine, summarize, sortRecords, previousOf, validateSubmission, todayLocal } from './records.mjs';
import { buildSheet, sheetFilename } from './pdf.mjs';
import { pinMatches, makeSessionCookie, clearCookie, readSession, lockState, noteFailure, clearFailures } from './auth.mjs';
import { AirtableError } from './airtable.mjs';

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
const fail = (message, status = 400, extra = {}) => json({ error: message, ...extra }, status);

let machineCache = { at: 0, list: null };
export function resetMachineCache() { machineCache = { at: 0, list: null }; }

async function getMachines(at, now) {
  if (machineCache.list && now - machineCache.at < 5 * 60000) return machineCache.list;
  const list = machinesFromTables(await at.listTables());
  machineCache = { at: now, list };
  return list;
}

/** Read one machine's records from Airtable and refresh the office cache for it. */
async function loadTable(deps, machine) {
  const recs = await deps.airtable.listRecords(machine.tableId);
  const records = sortRecords(recs.map(summarize));
  await deps.store.set(`tbl/${machine.tableId}`, { at: deps.now(), records });
  return records;
}

function pdfData(machine, rec, sorted) {
  const prev = previousOf(sorted, rec.id);
  return {
    eq: machine.id, sn: machine.sn, date: rec.date, hours: rec.hours, by: rec.by, level: rec.level,
    types: rec.types, filters: rec.filters, allFilters: machine.filters, fluids: rec.fluids,
    parts: rec.parts, notes: rec.notes, prev: prev ? { hours: prev.hours, date: prev.date } : null,
    submitted: rec.created,
  };
}

async function attachSheet(deps, machine, rec, sorted) {
  if (!machine.sheetFieldId) return false;
  const bytes = await buildSheet(pdfData(machine, rec, sorted));
  await deps.airtable.uploadAttachment(rec.id, machine.sheetFieldId, {
    filename: sheetFilename(machine.id, rec.date), contentType: 'application/pdf', bytes,
  });
  return true;
}

async function readBody(req) {
  try { return await req.json(); } catch { return null; }
}

export async function handle(req, deps) {
  const { env } = deps;
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  const method = req.method;
  const now = deps.now();
  const secure = url.protocol === 'https:';

  if (!env.AIRTABLE_TOKEN || !env.SESSION_SECRET || !env.MECH_PIN || !env.OFFICE_PIN) {
    return fail('The app is not set up yet: one of AIRTABLE_TOKEN, SESSION_SECRET, MECH_PIN or OFFICE_PIN is missing in Netlify.', 500);
  }
  if (String(env.SESSION_SECRET).length < 24) return fail('SESSION_SECRET in Netlify must be at least 24 characters.', 500);

  // Forms only come from our own pages.
  if (method !== 'GET') {
    const origin = req.headers.get('origin');
    if (origin && origin !== url.origin) return fail('Not allowed.', 403);
  }

  try {
    // ---------- sign-in ----------
    if (path === '/login' && method === 'POST') {
      const b = await readBody(req);
      const role = b?.role === 'office' ? 'office' : 'mech';
      const ip = deps.ip || 'unknown';
      const lock = await lockState(deps.store, role, ip, now);
      if (lock.until > now) {
        const mins = Math.ceil((lock.until - now) / 60000);
        return fail(`Too many wrong tries. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 429);
      }
      if (!pinMatches(role, b?.pin, env)) {
        const after = await noteFailure(deps.store, role, ip, now);
        if (after.until > now) return fail('Too many wrong tries. Try again in 15 minutes.', 429);
        return fail("That PIN didn't match. Try again.", 401);
      }
      await clearFailures(deps.store, role, ip);
      return json({ ok: true, role }, 200, { 'Set-Cookie': makeSessionCookie(role, env, now, secure) });
    }
    if (path === '/logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(secure) });
    }

    const role = readSession(req, env, now);
    if (path === '/me') return json({ role });
    if (!role) return fail('Please sign in.', 401);
    const isOffice = role === 'office';

    // ---------- mechanic ----------
    if (path === '/setup' && method === 'GET') {
      const machines = await getMachines(deps.airtable, now);
      return json({
        role, today: todayLocal(new Date(now)),
        mechanics: MECHANICS, levels: LEVELS, types: TYPES, fluids: FLUIDS, units: UNITS,
        machines: machines.map((m) => ({ id: m.id, sn: m.sn })),
      });
    }

    if (path === '/machine' && method === 'GET') {
      const machines = await getMachines(deps.airtable, now);
      const m = findMachine(machines, url.searchParams.get('id'));
      if (!m) return fail('No machine with that ID. Check the number on the machine.', 404);
      const records = await loadTable(deps, m);
      return json({ id: m.id, sn: m.sn, filters: m.filters, records });
    }

    if (path === '/service' && method === 'POST') {
      const b = await readBody(req);
      if (!b) return fail('Nothing was sent.');
      const clientId = typeof b.clientId === 'string' && /^[\w-]{8,64}$/.test(b.clientId) ? b.clientId : null;
      if (clientId) {
        const seen = await deps.store.get(`sub/${clientId}`);
        if (seen) return json({ ok: true, duplicate: true, ...seen });
      }
      const machines = await getMachines(deps.airtable, now);
      const m = findMachine(machines, b.eq);
      if (!m) return fail('No machine with that ID. Check the number on the machine.', 404);
      const checked = validateSubmission(b, m, new Date(now));
      if (checked.errors) return fail(checked.errors.join(' '), 400, { errors: checked.errors });

      const created = await deps.airtable.createRecord(m.tableId, checked.fields);
      const result = { recordId: created.id, eq: m.id, hours: checked.value.hours, date: checked.value.date, pdfSaved: false };
      if (clientId) await deps.store.set(`sub/${clientId}`, result);

      // PDF: build from the saved record so it matches Airtable exactly.
      try {
        let sorted = await loadTable(deps, m);
        let rec = sorted.find((r) => r.id === created.id);
        if (!rec) { rec = summarize(created); sorted = sortRecords([rec, ...sorted]); }
        result.pdfSaved = await attachSheet(deps, m, rec, sorted);
        if (result.pdfSaved) {
          rec.pdf = true;
          await deps.store.set(`tbl/${m.tableId}`, { at: deps.now(), records: sorted });
        }
        const prev = previousOf(sorted, rec.id);
        result.prevHours = prev?.hours ?? null;
      } catch (e) {
        deps.log?.(`PDF for ${created.id} not attached: ${e.message}`);
        result.pdfError = 'Saved, but the PDF sheet could not be attached. The office can attach it from the office page.';
      }
      if (clientId) await deps.store.set(`sub/${clientId}`, result);
      return json({ ok: true, ...result });
    }

    // ---------- office ----------
    if (path.startsWith('/office/') && !isOffice) return fail('Office sign-in needed.', 403);

    if (path === '/office/data' && method === 'GET') {
      const machines = await getMachines(deps.airtable, now);
      const keys = await deps.store.keys('tbl/');
      const tables = {};
      const wanted = new Set(machines.map((m) => `tbl/${m.tableId}`));
      const list = keys.filter((k) => wanted.has(k));
      for (let i = 0; i < list.length; i += 25) {
        const got = await Promise.all(list.slice(i, i + 25).map((k) => deps.store.get(k)));
        got.forEach((v, j) => { if (v) tables[list[i + j].slice(4)] = v; });
      }
      return json({
        mechanics: [...MECHANICS, ...PAST_MECHANICS], levels: LEVELS, types: TYPES, freshMinutes: CACHE_FRESH_MINUTES, now,
        machines: machines.map((m) => ({ id: m.id, tableId: m.tableId, sn: m.sn, filters: m.filters })),
        tables,
      });
    }

    if (path === '/office/refresh' && method === 'POST') {
      const b = await readBody(req);
      const ids = Array.isArray(b?.tableIds) ? b.tableIds.slice(0, 8) : [];
      const machines = await getMachines(deps.airtable, now);
      const tables = {};
      for (const id of ids) {
        const m = machines.find((x) => x.tableId === id);
        if (!m) continue;
        tables[id] = { at: deps.now(), records: await loadTable(deps, m) };
      }
      return json({ tables });
    }

    if (path === '/office/pdf' && method === 'GET') {
      const machines = await getMachines(deps.airtable, now);
      const m = machines.find((x) => x.tableId === url.searchParams.get('t'));
      if (!m) return fail('Machine not found.', 404);
      const sorted = await loadTable(deps, m);
      const rec = sorted.find((r) => r.id === url.searchParams.get('r'));
      if (!rec) return fail('That service record was not found. It may have been deleted in Airtable.', 404);
      const bytes = await buildSheet(pdfData(m, rec, sorted));
      const name = sheetFilename(m.id, rec.date);
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `${url.searchParams.get('view') ? 'inline' : 'attachment'}; filename="${name}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (path === '/office/attach' && method === 'POST') {
      const b = await readBody(req);
      const machines = await getMachines(deps.airtable, now);
      const m = machines.find((x) => x.tableId === b?.tableId);
      if (!m) return fail('Machine not found.', 404);
      if (!m.sheetFieldId) return fail(`The ${m.id} table has no PM SHEET field.`, 400);
      const sorted = await loadTable(deps, m);
      const rec = sorted.find((r) => r.id === b?.recordId);
      if (!rec) return fail('That service record was not found.', 404);
      await attachSheet(deps, m, rec, sorted);
      rec.pdf = true;
      await deps.store.set(`tbl/${m.tableId}`, { at: deps.now(), records: sorted });
      return json({ ok: true });
    }

    return fail('Not found.', 404);
  } catch (e) {
    if (e instanceof AirtableError) {
      deps.log?.(`Airtable ${e.status}: ${e.message}`);
      if (e.busy) return fail(e.message, 503);
      if (e.status === 401 || e.status === 403) return fail('The app could not get into Airtable. Check the AIRTABLE_TOKEN in Netlify and that it has access to the Equipment PM Services base.', 502);
      return fail(`Airtable said: ${e.message}`, 502);
    }
    deps.log?.(`Error: ${e.stack || e.message}`);
    return fail('Something went wrong on the server. Try again.', 500);
  }
}
