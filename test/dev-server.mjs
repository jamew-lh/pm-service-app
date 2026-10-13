// Local preview with the fake Airtable (99 real machine tables, sample records).
// node test/dev-server.mjs  ->  http://localhost:8888  (mechanic PIN 4321, office PIN OFFICETEST9)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { handle } from '../lib/app.mjs';
import { memoryStore } from '../lib/store.mjs';
import { makeFakeAirtable } from './fake-airtable.mjs';

const PORT = Number(process.env.PORT || 8888);
const root = new URL('../public/', import.meta.url).pathname;
const env = { AIRTABLE_TOKEN: 'fake', SESSION_SECRET: 'local-preview-secret-0123456789', MECH_PIN: '4321', OFFICE_PIN: 'OFFICETEST9' };
const deps = { env, airtable: makeFakeAirtable(), store: memoryStore(), now: () => Date.now(), ip: '127.0.0.1', log: (m) => console.log(m) };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), deps);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  const p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = normalize(join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(PORT, () => console.log(`Preview: http://localhost:${PORT}  (office: /office.html)`));
