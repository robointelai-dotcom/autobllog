import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

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
const AUTH_FILE = process.env.DASHBOARD_AUTH_FILE || path.join(DATA_DIR, 'dashboard-auth.json');
const sessions = new Map();
let storeCache = null;

function nowIso(){ return new Date().toISOString(); }

function ensureDataDir(){
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
}

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
  } catch {
    return false;
  }
}

function verifyPassword(password, passwordHash){
  if (!passwordHash?.salt || !passwordHash?.hash) return false;
  const iterations = Number(passwordHash.iterations || HASH_ITERATIONS);
  const keyLength = Number(passwordHash.keyLength || KEY_LENGTH);
  const digest = passwordHash.digest || 'sha256';
  const candidate = crypto.pbkdf2Sync(String(password), passwordHash.salt, iterations, keyLength, digest).toString('hex');
  return timingSafeEqualHex(candidate, passwordHash.hash);
}

function loadStore(){
  if (storeCache) return storeCache;
  ensureDataDir();
  if (!fs.existsSync(AUTH_FILE)) {
    storeCache = {
      username: DEFAULT_USERNAME,
      passwordHash: hashPassword(DEFAULT_PASSWORD),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      passwordChangedAt: null
    };
    saveStore(storeCache);
    return storeCache;
  }
  const parsed = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  if (!parsed.username || !parsed.passwordHash?.hash) {
    throw new Error('Invalid dashboard auth file. Delete it or fix server/data/dashboard-auth.json.');
  }
  storeCache = parsed;
  return storeCache;
}

function saveStore(store){
  ensureDataDir();
  const tmp = AUTH_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, AUTH_FILE);
  storeCache = store;
}

function parseCookieHeader(header = ''){
  const out = {};
  for (const part of String(header).split(';')){
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const val = part.slice(i + 1).trim();
    if (!key) continue;
    try { out[key] = decodeURIComponent(val); }
    catch { out[key] = val; }
  }
  return out;
}

function getSessionId(req){
  return parseCookieHeader(req.headers.cookie || '')[SESSION_COOKIE] || '';
}

function cookieOptions(req, maxAgeSeconds){
  const secure = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : (process.env.NODE_ENV === 'production' && (req.secure || req.get('x-forwarded-proto') === 'https'));
  return [
    `${SESSION_COOKIE}=`,
    `Max-Age=${maxAgeSeconds}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : ''
  ].filter(Boolean).join('; ');
}

function setSessionCookie(req, res, sid){
  res.setHeader('Set-Cookie', cookieOptions(req, Math.floor(SESSION_TTL_MS / 1000)).replace(`${SESSION_COOKIE}=`, `${SESSION_COOKIE}=${encodeURIComponent(sid)}`));
}

function clearSessionCookie(req, res){
  res.setHeader('Set-Cookie', cookieOptions(req, 0));
}

function createSession(username){
  const sid = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(sid, { username, expiresAt, createdAt: Date.now() });
  return sid;
}

function destroySession(req){
  const sid = getSessionId(req);
  if (sid) sessions.delete(sid);
}

function getSession(req){
  const sid = getSessionId(req);
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sid);
    return null;
  }
  return session;
}

setInterval(() => {
  const t = Date.now();
  for (const [sid, session] of sessions.entries()) {
    if (!session || session.expiresAt <= t) sessions.delete(sid);
  }
}, 60 * 60 * 1000).unref?.();

export function getDashboardUser(req){
  const session = getSession(req);
  if (!session) return null;
  return { username: session.username };
}

export function requireDashboardAuth(req, res, next){
  const user = getDashboardUser(req);
  if (!user) return res.status(401).json({ error: 'Dashboard login required', code: 'AUTH_REQUIRED' });
  req.dashboardUser = user;
  return next();
}

export const authRouter = express.Router();

authRouter.get('/me', (req, res) => {
  const user = getDashboardUser(req);
  if (!user) return res.status(401).json({ authenticated: false, error: 'Dashboard login required' });
  res.json({ authenticated: true, user, sessionDays: SESSION_DAYS });
});

authRouter.post('/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const store = loadStore();
  const usernameOk = username === store.username;
  const passwordOk = verifyPassword(password, store.passwordHash);
  if (!usernameOk || !passwordOk) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const sid = createSession(store.username);
  setSessionCookie(req, res, sid);
  res.json({ ok: true, user: { username: store.username }, sessionDays: SESSION_DAYS });
});

authRouter.post('/logout', (req, res) => {
  destroySession(req);
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

authRouter.post('/change-password', requireDashboardAuth, (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newUsername = String(req.body?.newUsername || '').trim();
  const newPassword = String(req.body?.newPassword || '');
  const store = loadStore();

  if (!verifyPassword(currentPassword, store.passwordHash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (!newUsername || newUsername.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (newPassword && newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const updated = {
    ...store,
    username: newUsername,
    updatedAt: nowIso()
  };
  if (newPassword) {
    updated.passwordHash = hashPassword(newPassword);
    updated.passwordChangedAt = nowIso();
  }
  saveStore(updated);

  // Keep the current browser logged in, but update its session username.
  const sid = getSessionId(req);
  const session = sid ? sessions.get(sid) : null;
  if (session) session.username = updated.username;

  res.json({ ok: true, user: { username: updated.username }, passwordChanged: Boolean(newPassword) });
});

// Create the auth file at boot so first deploy is predictable.
loadStore();
