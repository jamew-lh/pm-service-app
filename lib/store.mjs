// Small key-value storage for the office list cache, wrong-PIN counters and
// duplicate-submit protection. Uses Netlify Blobs on Netlify, memory elsewhere
// (local preview and tests).
import { getStore } from '@netlify/blobs';

function memoryStore() {
  const m = new Map();
  return {
    kind: 'memory',
    async get(key) { return m.has(key) ? structuredClone(m.get(key)) : null; },
    async set(key, value) { m.set(key, structuredClone(value)); },
    async del(key) { m.delete(key); },
    async keys(prefix) { return [...m.keys()].filter((k) => k.startsWith(prefix)); },
  };
}

function blobStore() {
  const s = getStore({ name: 'pm-service', consistency: 'strong' });
  return {
    kind: 'blobs',
    async get(key) { return s.get(key, { type: 'json' }); },
    async set(key, value) { await s.setJSON(key, value); },
    async del(key) { await s.delete(key); },
    async keys(prefix) {
      const out = [];
      for await (const page of s.list({ prefix, paginate: true })) out.push(...page.blobs.map((b) => b.key));
      return out;
    },
  };
}

// Opened once per request on Netlify (its access details come with each request).
let fallback = null;
export function openStore() {
  try {
    return blobStore();
  } catch {
    fallback ||= memoryStore();
    return fallback;
  }
}

export { memoryStore };
