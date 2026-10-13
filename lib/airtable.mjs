// Small Airtable client. Keeps under Airtable's limit of 5 requests per second
// per base by spacing requests, and turns errors into plain messages.

export class AirtableError extends Error {
  constructor(message, status, busy = false) {
    super(message);
    this.status = status;
    this.busy = busy;
  }
}

export function makeAirtable({ token, baseId, fetchImpl = globalThis.fetch, minGapMs = 220 }) {
  let chain = Promise.resolve();
  let last = 0;

  function slot() {
    const p = chain.then(async () => {
      const wait = last + minGapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
    });
    chain = p.catch(() => {});
    return p;
  }

  async function request(method, url, body) {
    await slot();
    const res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      if (res.status === 429) throw new AirtableError('Airtable is busy. Wait 30 seconds and try again.', 429, true);
      const msg = data?.error?.message || data?.error?.type || data?.error || `Airtable error ${res.status}`;
      throw new AirtableError(typeof msg === 'string' ? msg : JSON.stringify(msg), res.status);
    }
    return data;
  }

  const api = `https://api.airtable.com/v0/${baseId}`;

  return {
    async listTables() {
      const data = await request('GET', `https://api.airtable.com/v0/meta/bases/${baseId}/tables`);
      return data.tables;
    },

    async listRecords(tableId, { sortField, direction = 'desc', max = 1000 } = {}) {
      const out = [];
      let offset;
      do {
        const q = new URLSearchParams({ pageSize: '100' });
        if (sortField) { q.set('sort[0][field]', sortField); q.set('sort[0][direction]', direction); }
        if (offset) q.set('offset', offset);
        const data = await request('GET', `${api}/${encodeURIComponent(tableId)}?${q}`);
        out.push(...data.records);
        offset = data.offset;
      } while (offset && out.length < max);
      return out;
    },

    getRecord(tableId, recordId) {
      return request('GET', `${api}/${encodeURIComponent(tableId)}/${recordId}`);
    },

    createRecord(tableId, fields) {
      return request('POST', `${api}/${encodeURIComponent(tableId)}`, { fields, typecast: true });
    },

    uploadAttachment(recordId, fieldId, { filename, contentType, bytes }) {
      return request('POST', `https://content.airtable.com/v0/${baseId}/${recordId}/${fieldId}/uploadAttachment`, {
        contentType,
        filename,
        file: Buffer.from(bytes).toString('base64'),
      });
    },
  };
}
