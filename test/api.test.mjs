import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, resetMachineCache } from '../lib/app.mjs';
import { memoryStore } from '../lib/store.mjs';
import { makeAirtable } from '../lib/airtable.mjs';
import { splitFilter, findMachine, machinesFromTables } from '../lib/records.mjs';
import { makeFakeAirtable, machineByName } from './fake-airtable.mjs';

const ENV = { AIRTABLE_TOKEN: 'patTEST', SESSION_SECRET: 'x'.repeat(32), MECH_PIN: '4321', OFFICE_PIN: 'OFFICETEST9' };
const NOW = Date.parse('2026-10-13T14:00:00Z');

function setup(opts = {}) {
  resetMachineCache();
  const airtable = makeFakeAirtable(opts);
  const store = memoryStore();
  let clock = NOW;
  const deps = { env: opts.env || ENV, airtable, store, now: () => clock, ip: opts.ip || '1.2.3.4', log: () => {} };
  const jar = { cookie: '' };
  async function call(method, path, body, { cookie = jar.cookie, origin } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;
    if (origin) headers.origin = origin;
    const res = await handle(new Request(`https://pm.example.com/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), deps);
    const set = res.headers.get('set-cookie');
    if (set) jar.cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }
  return { airtable, store, deps, call, jar, tick: (ms) => { clock += ms; } };
}

const service = (over = {}) => ({
  eq: '336-06', date: '2026-10-13', hours: 8400, mechanic: 'RUSHANE DAVIS MORGAN', level: 'SERVICE 1', types: ['AIR', 'OIL'],
  filters: ['PRIMARY AIR - 4969841', 'OIL - 5000483'], fluids: [{ name: '15W40', qty: '8', unit: 'GAL' }],
  parts: 'Belt 123', notes: 'All good', clientId: 'abc12345-test', ...over,
});

test('nothing works before signing in', async () => {
  const s = setup();
  assert.equal((await s.call('GET', '/setup')).status, 401);
  assert.equal((await s.call('POST', '/service', service())).status, 401);
  assert.deepEqual((await s.call('GET', '/me')).data, { role: null });
});

test('mechanic PIN 4321 signs in; wrong PIN does not', async () => {
  const s = setup();
  const bad = await s.call('POST', '/login', { role: 'mech', pin: '1234' });
  assert.equal(bad.status, 401);
  const ok = await s.call('POST', '/login', { role: 'mech', pin: '4321' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=15552000; Secure/);
  const me = await s.call('GET', '/me');
  assert.equal(me.data.role, 'mech');
  const setupRes = await s.call('GET', '/setup');
  assert.equal(setupRes.data.machines.length, 99);
  assert.ok(setupRes.data.mechanics.includes('RUSHANE DAVIS MORGAN'));
  assert.equal(setupRes.data.today, '2026-10-13');
});

test('mechanic cannot use office pages; office PIN can (any case)', async () => {
  const s = setup();
  await s.call('POST', '/login', { role: 'mech', pin: '4321' });
  assert.equal((await s.call('GET', '/office/data')).status, 403);
  assert.equal((await s.call('POST', '/login', { role: 'office', pin: '4321' })).status, 401);
  assert.equal((await s.call('POST', '/login', { role: 'office', pin: 'officetest9' })).status, 200);
  assert.equal((await s.call('GET', '/office/data')).status, 200);
  assert.equal((await s.call('GET', '/setup')).status, 200, 'office can also use mechanic screens');
});

test('five wrong PINs lock that device out for 15 minutes', async () => {
  const s = setup();
  for (let i = 0; i < 4; i++) assert.equal((await s.call('POST', '/login', { role: 'mech', pin: '0000' })).status, 401);
  assert.equal((await s.call('POST', '/login', { role: 'mech', pin: '0000' })).status, 429);
  const locked = await s.call('POST', '/login', { role: 'mech', pin: '4321' });
  assert.equal(locked.status, 429, 'even the right PIN waits');
  assert.match(locked.data.error, /15 minutes/);
  s.tick(15 * 60000 + 1000);
  assert.equal((await s.call('POST', '/login', { role: 'mech', pin: '4321' })).status, 200);
});

test('a forged or expired cookie is refused, and changing the PIN signs people out', async () => {
  const s = setup();
  await s.call('POST', '/login', { role: 'mech', pin: '4321' });
  const good = s.jar.cookie;
  const [name, val] = good.split('=');
  const [payload, sig] = val.split('.');
  const forged = Buffer.from(JSON.stringify({ r: 'office', e: NOW + 1e9 })).toString('base64url');
  assert.equal((await s.call('GET', '/office/data', null, { cookie: `${name}=${forged}.${sig}` })).status, 401);
  s.deps.env = { ...ENV, MECH_PIN: '2222' };
  assert.equal((await s.call('GET', '/setup', null, { cookie: good })).status, 401);
  s.deps.env = ENV;
  s.tick(181 * 86400000);
  assert.equal((await s.call('GET', '/setup', null, { cookie: `${name}=${payload}.${sig}` })).status, 401);
});

test('machine lookup returns SN, filters and history newest first (with old "SERVICE 2" notes read as the level)', async () => {
  const s = setup();
  await s.call('POST', '/login', { role: 'mech', pin: '4321' });
  const r = await s.call('GET', '/machine?id=33606');
  assert.equal(r.status, 200);
  assert.equal(r.data.id, '336-06');
  assert.equal(r.data.sn, '0YBN10753');
  assert.equal(r.data.filters.length, 10);
  assert.deepEqual(r.data.records.map((x) => x.hours), [8270, 8065, 7340, 7000]);
  assert.equal(r.data.records[1].level, 'SERVICE 2');
  assert.equal(r.data.records[1].levelFromNotes, true);
  assert.deepEqual(r.data.records[3].fluids, [['10W', '30 GAL'], ['50W', '4.5 GAL']]);
  assert.equal((await s.call('GET', '/machine?id=999-99')).status, 404);
});

test('submitting a service writes the right fields to the machine table and attaches the PDF', async () => {
  const s = setup();
  await s.call('POST', '/login', { role: 'mech', pin: '4321' });
  const r = await s.call('POST', '/service', service({ fluids: [{ name: '15W40', qty: '8', unit: 'GAL' }, { name: 'OTHER', qty: '2', unit: 'QT', desc: 'DEF' }] }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.pdfSaved, true);
  assert.equal(r.data.prevHours, 8270);
  const t = s.airtable.tables.get(machineByName('336-06').tableId);
  const rec = t.records.find((x) => x.id === r.data.recordId);
  assert.deepEqual(
    Object.fromEntries(Object.entries(rec.fields).filter(([k]) => k !== 'PM SHEET')),
    {
      'EQUIPMENT ID': '336-06', 'SERIAL #': '0YBN10753', HOURS: 8400, DATE: '2026-10-13', EMPLOYEE: 'RUSHANE DAVIS MORGAN',
      'SERVICE LEVEL': 'SERVICE 1', 'SERVICE TYPE': ['AIR', 'OIL'], 'FILTERS CHANGED': ['PRIMARY AIR - 4969841', 'OIL - 5000483'],
      '15W40': '8 GAL', OTHER: '2 QT DEF', 'OTHER FILTERS/PARTS': 'Belt 123', 'SERVICE NOTES': 'All good',
    });
  const pdf = rec.fields['PM SHEET'][0];
  assert.equal(pdf.filename, 'PM Service 336-06 2026-10-13.pdf');
  assert.equal(pdf.type, 'application/pdf');
  assert.equal(Buffer.from(pdf.bytes.slice(0, 5)).toString(), '%PDF-');
});

test('tapping Submit twice only saves once', async () => {
  const s = setup();
  await s.call('POST', '/login', { role: 'mech', pin: '4321' });
  const a = await s.call('POST', '/service', service());
  const b = await s.call('POST', '/service', service());
  assert.equal(b.data.duplicate, true);
  assert.equal(a.data.recordId, b.data.recordId);
  assert.equal(s.airtable.counts.creates, 1);
});

test('bad submissions are explained, not saved', async () => {
  const s = setup();
  await s.call('POST', '/login', { role: 'mech', pin: '4321' });
  const cases = [
    [{ mechanic: 'BOB' }, /who did the service/],
    [{ hours: '' }, /hour meter/],
    [{ date: '2026-10-20' }, /future/],
    [{ level: '', types: [] }, /Pick the service/],
    [{ filters: ['OIL - 4621171'] }, /filters isn't on this machine/],
    [{ fluids: [{ name: '15W40', qty: '', unit: 'GAL' }] }, /how much 15W40/],
    [{ fluids: [{ name: 'OTHER', qty: '1', unit: 'GAL' }] }, /"Other" fluid/],
    [{ eq: 'NOPE' }, /No machine/],
  ];
  for (const [over, re] of cases) {
    const r = await s.call('POST', '/service', service({ ...over, clientId: undefined }));
    assert.ok(r.status === 400 || r.status === 404, `${JSON.stringify(over)} -> ${r.status}`);
    assert.match(r.data.error, re);
  }
  assert.equal(s.airtable.counts.creates, 0);
});

test('if the PDF upload fails the service is still saved, and the office can attach it later', async () => {
  const s = setup({ failUpload: true });
  await s.call('POST', '/login', { role: 'mech', pin: '4321' });
  const r = await s.call('POST', '/service', service());
  assert.equal(r.status, 200);
  assert.equal(r.data.pdfSaved, false);
  assert.match(r.data.pdfError, /office can attach/);
  assert.equal(s.airtable.counts.creates, 1);
});

test('office list: cache fills in chunks, PDF downloads, older records can get a sheet attached', async () => {
  const s = setup();
  await s.call('POST', '/login', { role: 'office', pin: 'OFFICETEST9' });
  const d1 = await s.call('GET', '/office/data');
  assert.equal(d1.data.machines.length, 99);
  assert.deepEqual(d1.data.tables, {});
  const ids = d1.data.machines.map((m) => m.tableId);
  const big = await s.call('POST', '/office/refresh', { tableIds: ids.slice(0, 20) });
  assert.equal(Object.keys(big.data.tables).length, 8, 'at most 8 machines per call');
  for (let i = 8; i < ids.length; i += 8) await s.call('POST', '/office/refresh', { tableIds: ids.slice(i, i + 8) });
  const d2 = await s.call('GET', '/office/data');
  assert.equal(Object.keys(d2.data.tables).length, 99);
  const t336 = machineByName('336-06').tableId;
  const rec = d2.data.tables[t336].records[1];
  const pdf = await s.call('GET', `/office/pdf?t=${t336}&r=${rec.id}`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition'), /attachment; filename="PM Service 336-06 2026-08-06.pdf"/);
  assert.equal(Buffer.from(pdf.data.slice(0, 5)).toString(), '%PDF-');
  assert.equal(rec.pdf, false);
  const at = await s.call('POST', '/office/attach', { tableId: t336, recordId: rec.id });
  assert.equal(at.status, 200);
  const d3 = await s.call('GET', '/office/data');
  assert.equal(d3.data.tables[t336].records[1].pdf, true);
});

test('a new submission shows up in the office data straight away', async () => {
  const s = setup();
  await s.call('POST', '/login', { role: 'mech', pin: '4321' });
  const r = await s.call('POST', '/service', service({ eq: '938-09', filters: [], hours: 6400 }));
  await s.call('POST', '/login', { role: 'office', pin: 'OFFICETEST9' });
  const d = await s.call('GET', '/office/data');
  const recs = d.data.tables[machineByName('938-09').tableId].records;
  assert.equal(recs[0].id, r.data.recordId);
  assert.equal(recs[0].pdf, true);
});

test('requests from another website are refused', async () => {
  const s = setup();
  const r = await s.call('POST', '/login', { role: 'mech', pin: '4321' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('missing settings give a clear message', async () => {
  const s = setup({ env: { ...ENV, OFFICE_PIN: '' } });
  const r = await s.call('GET', '/me');
  assert.equal(r.status, 500);
  assert.match(r.data.error, /OFFICE_PIN/);
});

test('filter labels split into name and part number, including the "-1421403" style', () => {
  assert.deepEqual(splitFilter('PRIMARY AIR - 4969841'), { name: 'PRIMARY AIR', part: '4969841' });
  assert.deepEqual(splitFilter('SECONDARY AIR -1421403'), { name: 'SECONDARY AIR', part: '1421403' });
  assert.deepEqual(splitFilter('SECONDARY FUEL - (2) 1R0749'), { name: 'SECONDARY FUEL', part: '(2) 1R0749' });
  assert.deepEqual(splitFilter('HYDRAULIC #2 - LW12210161'), { name: 'HYDRAULIC #2', part: 'LW12210161' });
});

test('equipment ID matching ignores dashes, spaces and case', async () => {
  const fake = makeFakeAirtable();
  const machines = machinesFromTables(await fake.listTables());
  assert.equal(findMachine(machines, 'jd324 01').id, 'JD324-01');
  assert.equal(findMachine(machines, 'd6t-02').id, 'D6T-02');
  assert.equal(findMachine(machines, ''), null);
});

test('Airtable client: paging, sort, typecast, upload URL, busy message', async () => {
  const calls = [];
  const pages = [{ records: [{ id: 'a' }], offset: 'o1' }, { records: [{ id: 'b' }] }];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('content.airtable.com')) return new Response('{"id":"rec1"}', { status: 200 });
    if (init.method === 'POST') return new Response('{"id":"recNew","fields":{}}', { status: 200 });
    if (url.includes('busy')) return new Response('{}', { status: 429 });
    return new Response(JSON.stringify(pages.shift()), { status: 200 });
  };
  const at = makeAirtable({ token: 'tok', baseId: 'appX', fetchImpl, minGapMs: 0 });
  const recs = await at.listRecords('tblA', { sortField: 'DATE' });
  assert.deepEqual(recs.map((r) => r.id), ['a', 'b']);
  assert.match(calls[0].url, /sort%5B0%5D%5Bfield%5D=DATE/);
  assert.match(calls[1].url, /offset=o1/);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  await at.createRecord('tblA', { HOURS: 1 });
  assert.deepEqual(JSON.parse(calls[2].init.body), { fields: { HOURS: 1 }, typecast: true });
  await at.uploadAttachment('rec1', 'fldP', { filename: 'a.pdf', contentType: 'application/pdf', bytes: new Uint8Array([37, 80]) });
  assert.equal(calls[3].url, 'https://content.airtable.com/v0/appX/rec1/fldP/uploadAttachment');
  assert.deepEqual(JSON.parse(calls[3].init.body), { contentType: 'application/pdf', filename: 'a.pdf', file: 'JVA=' });
  await assert.rejects(at.listRecords('busy'), /busy/);
});
