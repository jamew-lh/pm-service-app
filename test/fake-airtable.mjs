// In-memory stand-in for Airtable, shaped like the real base: 99 machine tables
// with the same fields, plus a few real service records to look at.
import { readFileSync } from 'node:fs';
import { FLUIDS } from '../lib/config.mjs';

const MACHINES = JSON.parse(readFileSync(new URL('./fixtures/machines.json', import.meta.url)));

const STD = ['EQUIPMENT ID', 'SERIAL #', 'HOURS', 'DATE', 'EMPLOYEE', 'SERVICE TYPE', 'SERVICE NOTES',
  ...FLUIDS.slice(0, 6), 'OTHER', 'ATF', 'ANTIFREEZE', 'GEAR LUBE', 'GREASE', 'FILTERS CHANGED', 'OTHER FILTERS/PARTS',
  'SERVICE LEVEL', 'PM SHEET'];

let n = 0;
const rid = () => `rec${String(++n).padStart(14, '0')}`;

// Real records (from Airtable) for a few machines.
const SEED = {
  '336-06': [
    { DATE: '2026-10-08', HOURS: 8270, EMPLOYEE: 'DOUG GREIG', 'SERVICE TYPE': ['AIR'], 'FILTERS CHANGED': ['PRIMARY AC - 5805439', 'SECONDARY AC - 5000957'], 'OTHER FILTERS/PARTS': 'Checked filters and fluid ' },
    { DATE: '2026-08-06', HOURS: 8065, EMPLOYEE: 'DOUG GREIG', 'SERVICE TYPE': ['AIR', 'FUEL', 'OIL'], 'FILTERS CHANGED': ['PRIMARY AIR - 4969841', 'SECONDARY AIR - 4969842', 'PRIMARY AC - 5805439', 'SECONDARY AC - 5000957', 'OIL - 5000483', 'PRIMARY FUEL - 4343928', 'SECONDARY FUEL - 5234987'], '15W40': '8 GAL', 'SERVICE NOTES': 'SERVICE 2' },
    { DATE: '2026-01-13', HOURS: 7340, EMPLOYEE: 'DOUG GREIG', 'SERVICE TYPE': ['OIL'], 'FILTERS CHANGED': ['OIL - 5000483'], '15W40': '8 GAL', 'SERVICE NOTES': 'SERVICE 2' },
    { DATE: '2025-10-30', HOURS: 7000, EMPLOYEE: 'DOUG GREIG', 'SERVICE TYPE': ['HYD'], 'FILTERS CHANGED': ['IN TANK CASE DRAIN SCREEN - 4916075', 'IN TANK RETURN - 5990905'], '10W': '30 GAL', '50W': '4.5 GAL', 'SERVICE NOTES': 'SERVICE 3' },
  ],
  '938-09': [
    { DATE: '2026-09-10', HOURS: 6200, EMPLOYEE: 'DOUG GREIG', 'SERVICE TYPE': ['AIR', 'OIL', 'FUEL'], '15W40': '20qt', '10W': '1 gal' },
    { DATE: '2026-08-13', HOURS: 6045, EMPLOYEE: 'DOUG GREIG', 'SERVICE TYPE': ['AIR'], 'SERVICE NOTES': 'Checked all fluids ' },
    { DATE: '2026-04-14', HOURS: 5400, EMPLOYEE: 'DOUG GREIG', 'SERVICE TYPE': ['AIR', 'OIL', 'FUEL'], 'SERVICE NOTES': 'SERVICE 2', '15W40': '5 GAL', '10W': '1 GAL', ANTIFREEZE: '1 GAL' },
    { DATE: '2026-01-06', HOURS: 5000, EMPLOYEE: 'CHAD SMOKER', 'SERVICE TYPE': ['AIR', 'OIL', 'FUEL', 'HYD'], '15W40': '5gal' },
  ],
  '315-09': [
    { DATE: '2026-09-17', HOURS: 3020, EMPLOYEE: 'DOUG GREIG', 'SERVICE TYPE': ['AIR', 'OIL', 'FUEL'], '15W40': '3 gal ', '10W': '1 gal', 'SERVICE NOTES': 'Checked all fluids , top off 10W ' },
    { DATE: '2026-03-31', HOURS: 3, EMPLOYEE: 'CHAD SMOKER', 'SERVICE TYPE': ['AIR', 'OIL', 'FUEL'], '15W40': '5gal' },
    { DATE: '2025-12-18', HOURS: 2440, EMPLOYEE: 'DOUG GREIG', 'SERVICE TYPE': ['AIR'], 'OTHER FILTERS/PARTS': 'FILTERS CHECKED', 'SERVICE NOTES': 'SERVICE 1' },
  ],
  'D8R-04': [{ DATE: '2025-12-22', HOURS: 20555, EMPLOYEE: 'DOUG GREIG', 'SERVICE NOTES': 'SERVICE 3' }],
  'D6T-02': [{ DATE: '2026-03-11', HOURS: 15090, EMPLOYEE: 'DOUG GREIG', 'SERVICE NOTES': 'SERVICE 1 - NO FILTERS CHANGED' }],
  '730-05': [{ DATE: '2026-06-08', HOURS: 6820, EMPLOYEE: 'CHAD SMOKER' }],
};

export function makeFakeAirtable({ failUpload = false } = {}) {
  const tables = new Map();
  const counts = { requests: 0, uploads: 0, creates: 0 };
  for (const m of MACHINES) {
    const fields = STD.map((name, i) => {
      const f = { id: `fld${m.tableId.slice(3, 9)}${String(i).padStart(8, '0')}`, name, type: 'singleLineText' };
      if (name === 'SERIAL #') Object.assign(f, { type: 'singleSelect', options: { choices: [{ id: 'sel1', name: m.sn }] } });
      if (name === 'FILTERS CHANGED') Object.assign(f, { type: 'multipleSelects', options: { choices: m.filters.map((c, j) => ({ id: `sel${j}`, name: c })) } });
      if (name === 'PM SHEET') f.type = 'multipleAttachments';
      return f;
    });
    const records = (SEED[m.id] || []).map((fl, i) => ({
      id: rid(), createdTime: new Date(Date.parse(`${fl.DATE}T13:00:00Z`) + i).toISOString(),
      fields: { 'EQUIPMENT ID': m.id, 'SERIAL #': m.sn, ...fl },
    }));
    tables.set(m.tableId, { meta: { id: m.tableId, name: m.id, fields }, records });
  }

  const sheetFieldId = (tableId) => tables.get(tableId).meta.fields.find((f) => f.name === 'PM SHEET').id;

  return {
    counts,
    tables,
    sheetFieldId,
    async listTables() { counts.requests++; return [...tables.values()].map((t) => structuredClone(t.meta)); },
    async listRecords(tableId) {
      counts.requests++;
      const t = tables.get(tableId);
      if (!t) throw Object.assign(new Error('NOT_FOUND'), { status: 404 });
      return structuredClone(t.records);
    },
    async getRecord(tableId, id) { counts.requests++; return structuredClone(tables.get(tableId).records.find((r) => r.id === id)); },
    async createRecord(tableId, fields) {
      counts.requests++; counts.creates++;
      const t = tables.get(tableId);
      const known = new Set(t.meta.fields.map((f) => f.name));
      for (const k of Object.keys(fields)) if (!known.has(k)) throw new Error(`Unknown field name: "${k}"`);
      const rec = { id: rid(), createdTime: new Date().toISOString(), fields: structuredClone(fields) };
      t.records.push(rec);
      return structuredClone(rec);
    },
    async uploadAttachment(recordId, fieldId, { filename, contentType, bytes }) {
      counts.requests++; counts.uploads++;
      if (failUpload) throw new Error('upload failed');
      for (const t of tables.values()) {
        const r = t.records.find((x) => x.id === recordId);
        if (r) {
          if (sheetFieldId(t.meta.id) !== fieldId) throw new Error('wrong field');
          r.fields['PM SHEET'] = [...(r.fields['PM SHEET'] || []), { filename, type: contentType, size: bytes.length, bytes }];
          return { id: recordId };
        }
      }
      throw new Error('record not found');
    },
  };
}

export const machineByName = (name) => MACHINES.find((m) => m.id === name);
