import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { DEFAULT_TENANT, normalizeTenantSlug } from './tenants.js';

const DEFAULT_USERNAME = process.env.DASHBOARD_DEFAULT_USER || 'admin';
const DEFAULT_PASSWORD = process.env.DASHBOARD_DEFAULT_PASSWORD || 'admin@2020';
const SESSION_COOKIE = process.env.DASHBOARD_SESSION_COOKIE || 'ab_dashboard_sid';
const SESSION_DAYS = Math.max(1, Number(process.env.DASHBOARD_SESSION_DAYS || 7));
const SESSION_TTL_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const HASH_ITERATIONS = 120000;
const KEY_LENGTH = 32;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const AUTH_FILE_OVERRIDE = process.env.DASHBOARD_AUTH_FILE || '';
const sessions = new Map();
const storeCache = new Map();

function tenantFromReq(req){ return normalizeTenantSlug(req?.tenantSlug || DEFAULT_TENANT); }
function nowIso(){ return new Date().toISOString(); }

function authFileForTenant(slug = DEFAULT_TENANT){
  const safe = normalizeTenantSlug(slug);
  if (AUTH_FILE_OVERRIDE && safe === DEFAULT_TENANT) return AUTH_FILE_OVERRIDE;
  if (safe === DEFAULT_TENANT) return path.join(DATA_DIR, 'dashboard-auth.json');
  return path.join(DATA_DIR, 'tenants', safe, 'dashboard-auth.json');
}

function ensureDataDir(file){ fs.mkdirSync(path.dirname(file), { recursive: true }); }

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')){
  const hash = crypto.pbkdf2Sync(String(password), salt, HASH_ITERATIONS, KEY_LENGTH, 'sha256').toString('hex');
  return { salt, hash, iterations: HASH_ITERATIONS, keyLength: KEY_LENGTH, digest: 'sha256' };
}

function timingSafeEqualHex(a, b){
  try {
    const aa = Buffer.from(String(a || ''), 'hex');
    const bb = Buffer.from(String(b || ''), 'hex');
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
  } catch { return false; }
}

function verifyPassword(password, passwordHash){
  if (!passwordHash?.salt || !passwordHash?.hash) return false;
  const iterations = Number(passwordHash.iterations || HASH_ITERATIONS);
  const keyLength = Number(passwordHash.keyLength || KEY_LENGTH);
  const digest = passwordHash.digest || 'sha256';
  const candidate = crypto.pbkdf2Sync(String(password), passwordHash.salt, iterations, keyLength, digest).toString('hex');
  return timingSafeEqualHex(candidate, passwordHash.hash);
}

function loadStore(slug = DEFAULT_TENANT){
  const safe = normalizeTenantSlug(slug);
  if (storeCache.has(safe)) return storeCache.get(safe);
  const file = authFileForTenant(safe);
  ensureDataDir(file);
  if (!fs.existsSync(file)) {
    const store = {
      tenantSlug: safe,
      username: DEFAULT_USERNAME,
      passwordHash: hashPassword(DEFAULT_PASSWORD),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      passwordChangedAt: null
    };
    saveStore(safe, store);
    return store;
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed.username || !parsed.passwordHash?.hash) throw new Error(`Invalid dashboard auth file: ${file}`);
  parsed.tenantSlug = parsed.tenantSlug || safe;
  storeCache.set(safe, parsed);
  return parsed;
}

function saveStore(slug, store){
  const safe = normalizeTenantSlug(slug);
  const file = authFileForTenant(safe);
  ensureDataDir(file);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...store, tenantSlug: safe }, null, 2));
  fs.renameSync(tmp, file);
  storeCache.set(safe, { ...store, tenantSlug: safe });
}

function parseCookieHeader(header = ''){
  const out = {};
  for (const part of String(header).split(';')){
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const val = part.slice(i + 1).trim();
    if (!key) continue;
    try { out[key] = decodeURIComponent(val); } catch { out[key] = val; }
  }
  return out;
}

function getSessionId(req){ return parseCookieHeader(req.headers.cookie || '')[SESSION_COOKIE] || ''; }

function cookieOptions(req, maxAgeSeconds){
  const secure = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : (process.env.NODE_ENV === 'production' && (req.secure || req.get('x-forwarded-proto') === 'https'));
  return [`${SESSION_COOKIE}=`, `Max-Age=${maxAgeSeconds}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', secure ? 'Secure' : ''].filter(Boolean).join('; ');
}

function setSessionCookie(req, res, sid){
  res.setHeader('Set-Cookie', cookieOptions(req, Math.floor(SESSION_TTL_MS / 1000)).replace(`${SESSION_COOKIE}=`, `${SESSION_COOKIE}=${encodeURIComponent(sid)}`));
}
function clearSessionCookie(req, res){ res.setHeader('Set-Cookie', cookieOptions(req, 0)); }

function createSession(username, tenantSlug){
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid, { username, tenantSlug, expiresAt: Date.now() + SESSION_TTL_MS, createdAt: Date.now() });
  return sid;
}
function destroySession(req){ const sid = getSessionId(req); if (sid) sessions.delete(sid); }
function getSession(req){
  const sid = getSessionId(req);
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) { sessions.delete(sid); return null; }
  if (session.tenantSlug !== tenantFromReq(req)) return null;
  return session;
}

setInterval(() => {
  const t = Date.now();
  for (const [sid, session] of sessions.entries()) if (!session || session.expiresAt <= t) sessions.delete(sid);
}, 60 * 60 * 1000).unref?.();

export function initializeTenantAuth(slug = DEFAULT_TENANT){ return loadStore(slug); }

export function getDashboardUser(req){
  const session = getSession(req);
  if (!session) return null;
  return { username: session.username, tenantSlug: session.tenantSlug };
}

export function requireDashboardAuth(req, res, next){
  const user = getDashboardUser(req);
  if (!user) return res.status(401).json({ error: 'Dashboard login required', code: 'AUTH_REQUIRED', tenantSlug: tenantFromReq(req) });
  req.dashboardUser = user;
  return next();
}

export const authRouter = express.Router();

authRouter.get('/me', (req, res) => {
  const user = getDashboardUser(req);
  if (!user) return res.status(401).json({ authenticated: false, error: 'Dashboard login required', tenantSlug: tenantFromReq(req) });
  res.json({ authenticated: true, user, sessionDays: SESSION_DAYS, tenantSlug: tenantFromReq(req), databaseName: req.tenantDatabaseName });
});

authRouter.post('/login', (req, res) => {
  const tenantSlug = tenantFromReq(req);
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const store = loadStore(tenantSlug);
  if (username !== store.username || !verifyPassword(password, store.passwordHash)) return res.status(401).json({ error: 'Invalid username or password' });
  const sid = createSession(store.username, tenantSlug);
  setSessionCookie(req, res, sid);
  res.json({ ok: true, user: { username: store.username, tenantSlug }, sessionDays: SESSION_DAYS, tenantSlug, databaseName: req.tenantDatabaseName });
});

authRouter.post('/logout', (req, res) => { destroySession(req); clearSessionCookie(req, res); res.json({ ok: true }); });

authRouter.post('/change-password', requireDashboardAuth, (req, res) => {
  const tenantSlug = tenantFromReq(req);
  const currentPassword = String(req.body?.currentPassword || '');
  const newUsername = String(req.body?.newUsername || '').trim();
  const newPassword = String(req.body?.newPassword || '');
  const store = loadStore(tenantSlug);
  if (!verifyPassword(currentPassword, store.passwordHash)) return res.status(400).json({ error: 'Current password is incorrect' });
  if (!newUsername || newUsername.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (newPassword && newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const updated = { ...store, username: newUsername, updatedAt: nowIso() };
  if (newPassword) { updated.passwordHash = hashPassword(newPassword); updated.passwordChangedAt = nowIso(); }
  saveStore(tenantSlug, updated);
  const sid = getSessionId(req);
  const session = sid ? sessions.get(sid) : null;
  if (session && session.tenantSlug === tenantSlug) session.username = updated.username;
  res.json({ ok: true, user: { username: updated.username, tenantSlug }, passwordChanged: Boolean(newPassword) });
});

initializeTenantAuth(DEFAULT_TENANT);
