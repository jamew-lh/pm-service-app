// Sign-in with the shared mechanic PIN or the office PIN.
// Sessions are a signed cookie. Changing a PIN in Netlify signs out everyone
// who used the old one, because the PIN is part of the signature.
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { SESSION_DAYS, LOCKOUT } from './config.mjs';

const COOKIE = 'pm_s';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function pinFor(role, env) {
  return role === 'office' ? env.OFFICE_PIN : env.MECH_PIN;
}

function sign(payload, role, env) {
  const pinPrint = createHash('sha256').update(String(pinFor(role, env) || '')).digest('hex');
  return createHmac('sha256', env.SESSION_SECRET).update(`${payload}|${pinPrint}`).digest('base64url');
}

function sameText(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Office PIN ignores upper/lower case; the mechanic PIN is digits. */
export function pinMatches(role, entered, env) {
  const real = pinFor(role, env);
  if (!real) return false;
  const norm = (s) => String(s ?? '').trim().toUpperCase();
  return sameText(norm(entered), norm(real));
}

export function makeSessionCookie(role, env, now = Date.now(), secure = true) {
  const exp = now + SESSION_DAYS[role] * 86400000;
  const payload = b64u(JSON.stringify({ r: role, e: exp }));
  const value = `${payload}.${sign(payload, role, env)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS[role] * 86400}${secure ? '; Secure' : ''}`;
}

export function clearCookie(secure = true) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

/** Returns 'mech', 'office' or null. */
export function readSession(req, env, now = Date.now()) {
  const raw = req.headers.get('cookie') || '';
  const m = raw.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!m) return null;
  const [payload, sig] = m.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (!['mech', 'office'].includes(data?.r) || !(data.e > now)) return null;
  if (!sameText(sig, sign(payload, data.r, env))) return null;
  return data.r;
}

/** Wrong-PIN lockout, kept per network address and role. */
export async function lockState(store, role, ip, now = Date.now()) {
  const rec = (await store.get(`rl/${role}/${ip}`)) || { fails: [], until: 0 };
  const windowMs = LOCKOUT.windowMinutes * 60000;
  rec.fails = rec.fails.filter((t) => now - t < windowMs);
  return rec;
}

export async function noteFailure(store, role, ip, now = Date.now()) {
  const rec = await lockState(store, role, ip, now);
  rec.fails.push(now);
  if (rec.fails.length >= LOCKOUT.maxFailures) {
    rec.until = now + LOCKOUT.lockMinutes * 60000;
    rec.fails = [];
  }
  await store.set(`rl/${role}/${ip}`, rec);
  return rec;
}

export async function clearFailures(store, role, ip) {
  await store.del(`rl/${role}/${ip}`);
}
