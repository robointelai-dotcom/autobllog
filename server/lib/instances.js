import fs from 'fs';
import path from 'path';
import http from 'http';
import net from 'net';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import mongoose from 'mongoose';
import ClientApp from '../models/ClientApp.js';
import { normalizeTenantSlug, tenantDbName } from './tenants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '../..');
const SERVER_INDEX = path.join(APP_ROOT, 'server', 'index.js');
const SERVER_DATA = path.join(APP_ROOT, 'server', 'data');
const INSTANCE_ROOT = process.env.CLIENT_INSTANCE_ROOT || '/opt/autoblog-clients';
function finitePort(value, fallback){
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : fallback;
}
const PORT_BASE = finitePort(process.env.CLIENT_PORT_BASE, 4100);
const PORT_MAX = Math.max(PORT_BASE, finitePort(process.env.CLIENT_PORT_MAX, 4999));
const DEFAULT_PASSWORD = process.env.DASHBOARD_DEFAULT_PASSWORD || 'admin@2020';

function ensureDir(dir){ fs.mkdirSync(dir, { recursive: true }); }
function sanitizeEnvName(slug){ return String(slug).replace(/[^a-z0-9]/gi, '_'); }
function logFile(slug){ return path.join(instanceDir(slug), 'logs', 'server.log'); }
export function instanceDir(slug){ return path.join(INSTANCE_ROOT, normalizeTenantSlug(slug)); }
export function isChildInstance(){ return process.env.AUTOBLOG_INSTANCE_CHILD === 'true'; }
export function currentInstanceSlug(){ return process.env.INSTANCE_SLUG || 'main'; }

function dbNameFromUri(uri){
  try {
    const u = new URL(uri);
    const db = u.pathname.replace(/^\//,'').split('/')[0];
    return db || 'remotecontroller';
  } catch { return 'remotecontroller'; }
}

export function mongoUriForDb(baseUri, dbName){
  const base = baseUri || process.env.MONGO_URI || process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/remotecontroller';
  try {
    const u = new URL(base);
    u.pathname = '/' + encodeURIComponent(dbName);
    return u.toString();
  } catch {
    return `mongodb://127.0.0.1:27017/${dbName}`;
  }
}

export function instanceDbName(slug){
  // Keep old v12 naming format for easy migration, but use it as a fully separate process database in v13.
  return tenantDbName(slug);
}

export function portIsOpen(port){
  return new Promise(resolve => {
    const socket = net.createConnection({ host:'127.0.0.1', port:Number(port) });
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1200);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

export async function findFreePort(existingPorts = []){
  const used = new Set((existingPorts || []).map(Number).filter(Boolean));
  for (let port = PORT_BASE; port <= PORT_MAX; port++) {
    if (used.has(port)) continue;
    // eslint-disable-next-line no-await-in-loop
    const open = await portIsOpen(port);
    if (!open) return port;
  }
  throw new Error(`No free client port found between ${PORT_BASE} and ${PORT_MAX}`);
}

export async function pickClientPort(){
  const rows = await ClientApp.find({ port: { $exists: true, $ne: null } }).select('port').lean().catch(()=>[]);
  return findFreePort(rows.map(r => r.port));
}

export async function checkInstanceHealth(port){
  return new Promise(resolve => {
    const req = http.request({ host:'127.0.0.1', port, path:'/api/healthz', method:'GET', timeout:2000 }, res => {
      let raw='';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(raw || '{}');
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300 && data?.ok === true, occupied:true, status: res.statusCode, data });
        } catch {
          resolve({ ok:false, occupied:true, status:res.statusCode, data:raw });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok:false, occupied:true, error:'timeout' }); });
    req.on('error', err => resolve({ ok:false, occupied:false, error:err.message }));
    req.end();
  });
}


function readPid(slug){
  const pidFile = path.join(instanceDir(slug), 'run.pid');
  try {
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

function removePidFile(slug){
  try { fs.rmSync(path.join(instanceDir(slug), 'run.pid'), { force:true }); } catch {}
}

function removePidFileIfMatches(slug, pid){
  const current = readPid(slug);
  if (!current || Number(current) === Number(pid)) removePidFile(slug);
}

function processExists(pid){
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

export function pidBelongsToClient(pid, slug){
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  const safeSlug = normalizeTenantSlug(slug);
  try {
    const env = fs.readFileSync(`/proc/${numericPid}/environ`, 'utf8').split('\0');
    return env.includes('AUTOBLOG_INSTANCE_CHILD=true') && env.includes(`INSTANCE_SLUG=${safeSlug}`);
  } catch {
    return false;
  }
}

async function waitForPortClosed(port, tries = 12){
  for (let i=0; i<tries; i++) {
    // eslint-disable-next-line no-await-in-loop
    const open = await portIsOpen(port);
    if (!open) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise(r => setTimeout(r, 350));
  }
  return false;
}

export async function stopClientInstance(client){
  const slug = normalizeTenantSlug(client.slug);
  if (slug === 'main') return { ok:false, error:'Main dashboard cannot be stopped here.' };
  const port = Number(client.port || 0);
  const pid = Number(client.processPid || readPid(slug) || 0);
  const killed = [];
  const stalePidWarning = pid && processExists(pid) && !pidBelongsToClient(pid, slug)
    ? `Saved PID ${pid} does not belong to client "${slug}" and was not killed.`
    : '';

  if (pid && pidBelongsToClient(pid, slug)) {
    try { process.kill(-pid, 'SIGTERM'); killed.push(`group:${pid}`); } catch {}
    try { process.kill(pid, 'SIGTERM'); killed.push(`pid:${pid}`); } catch {}
  }

  let portWarning = '';
  if (port) {
    await waitForPortClosed(port, 8);
    const still = await checkInstanceHealth(port);
    if (still.occupied) {
      const liveSlug = still.ok ? normalizeTenantSlug(still.data?.instanceSlug || still.data?.tenantSlug || 'main') : '';
      if (still.ok && liveSlug === slug) {
        try { spawnSync('fuser', ['-k', `${port}/tcp`], { stdio:'ignore' }); killed.push(`port:${port}`); } catch {}
        await waitForPortClosed(port, 8);
      } else {
        portWarning = still.ok
          ? `Port ${port} belongs to instance "${liveSlug}"; it was not killed.`
          : `Port ${port} is still occupied by an unidentified service; it was not killed.`;
      }
    }
  }

  removePidFile(slug);
  const warning = [stalePidWarning, portWarning].filter(Boolean).join(' ');
  await ClientApp.updateOne({ slug }, { $set: { processPid:null, processStatus: warning ? 'error' : 'stopped', lastError:warning } }).catch(()=>{});
  return { ok:!warning, slug, port: port || null, pid: pid || null, killed, warning };
}

export async function startClientInstance(client, options = {}){
  const slug = normalizeTenantSlug(client.slug);
  const port = Number(client.port);
  if (!port) throw new Error(`Client ${slug} has no assigned port`);
  if (isChildInstance()) throw new Error('Child instances cannot start other instances');

  if (options.force) {
    await stopClientInstance(client);
  }

  const already = await checkInstanceHealth(port);
  if (already.ok) {
    const liveSlug = normalizeTenantSlug(already.data?.instanceSlug || already.data?.tenantSlug || 'main');
    if (liveSlug !== slug) {
      throw new Error(`Port ${port} is occupied by instance "${liveSlug}", not "${slug}". Assign a free port before restarting.`);
    }
    await ClientApp.updateOne({ slug }, { $set: { processStatus:'running', lastStartedAt:new Date(), lastError:'' } }).catch(()=>{});
    return { ok:true, alreadyRunning:true, port, pid:client.processPid || null, health:already };
  }
  if (already.occupied) {
    throw new Error(`Port ${port} is occupied by a non-healthy or different service. Free the port or assign a new client port.`);
  }

  const dir = instanceDir(slug);
  ensureDir(path.join(dir, 'logs'));
  ensureDir(path.join(SERVER_DATA, 'instances', slug));

  const out = fs.openSync(logFile(slug), 'a');
  const dbName = client.databaseName || instanceDbName(slug);
  const childEnv = {
    ...process.env,
    AUTOBLOG_INSTANCE_CHILD: 'true',
    INSTANCE_SLUG: slug,
    INSTANCE_NAME: client.name || slug,
    PORT: String(port),
    MONGO_URI: mongoUriForDb(process.env.MONGO_URI || process.env.MONGO_URL, dbName),
    DASHBOARD_AUTH_FILE: path.join(SERVER_DATA, 'instances', slug, 'dashboard-auth.json'),
    DASHBOARD_SESSION_COOKIE: `ab_${sanitizeEnvName(slug)}_sid`,
    DASHBOARD_DEFAULT_USER: process.env.DASHBOARD_DEFAULT_USER || 'admin',
    DASHBOARD_DEFAULT_PASSWORD: DEFAULT_PASSWORD,
    CLIENT_INSTANCE_ROOT: INSTANCE_ROOT,
    AUTO_START_CLIENT_INSTANCES: 'false',
    NODE_ENV: 'production'
  };

  let child;
  try {
    child = spawn(process.execPath, [SERVER_INDEX], {
      cwd: path.join(APP_ROOT, 'server'),
      env: childEnv,
      detached: true,
      stdio: ['ignore', out, out]
    });
  } finally {
    // The child inherited a duplicate descriptor; close the parent's copy.
    try { fs.closeSync(out); } catch {}
  }
  child.on('error', err => {
    removePidFileIfMatches(slug, child.pid);
    ClientApp.updateOne({ slug, processPid:child.pid }, { $set: { processPid:null, processStatus:'error', lastError:`Failed to start client process: ${err.message}` } }).catch(()=>{});
  });
  child.on('exit', (code, signal) => {
    removePidFileIfMatches(slug, child.pid);
    const reason = signal ? `signal ${signal}` : `exit code ${code}`;
    ClientApp.updateOne({ slug, processPid:child.pid }, { $set: { processPid:null, processStatus: code === 0 ? 'stopped' : 'error', lastError: code === 0 ? '' : `Client process exited with ${reason}` } }).catch(()=>{});
  });
  child.unref();
  if (!child.pid) throw new Error(`Client instance ${slug} could not be spawned`);
  fs.writeFileSync(path.join(dir, 'run.pid'), String(child.pid));
  await ClientApp.updateOne({ slug }, { $set: { processPid: child.pid, processStatus:'starting', lastStartedAt:new Date(), lastError:'' } }).catch(()=>{});

  // Give it a few seconds to bind the port.
  for (let i=0;i<12;i++) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise(r => setTimeout(r, 500));
    // eslint-disable-next-line no-await-in-loop
    const health = await checkInstanceHealth(port);
    if (health.ok) {
      const liveSlug = normalizeTenantSlug(health.data?.instanceSlug || health.data?.tenantSlug || 'main');
      if (liveSlug !== slug) {
        const conflict = `Port ${port} answered as instance "${liveSlug}" while starting "${slug}".`;
        await ClientApp.updateOne({ slug }, { $set: { processStatus:'error', lastError:conflict } }).catch(()=>{});
        return { ok:false, port, pid:child.pid, error:conflict, health };
      }
      await ClientApp.updateOne({ slug }, { $set: { processStatus:'running', lastStartedAt:new Date(), lastError:'' } }).catch(()=>{});
      return { ok:true, port, pid:child.pid, health };
    }
  }
  const err = `Client instance ${slug} did not become healthy on port ${port}. Check ${logFile(slug)}`;
  await ClientApp.updateOne({ slug }, { $set: { processStatus:'error', lastError:err } }).catch(()=>{});
  return { ok:false, port, pid:child.pid, error:err };
}

export async function startAllClientInstances(){
  if (isChildInstance()) return [];
  if (process.env.AUTO_START_CLIENT_INSTANCES === 'false') return [];
  const clients = await ClientApp.find({ enabled:true, mode:'instance', slug: { $ne: 'main' } }).lean().catch(()=>[]);
  const results = [];
  for (const client of clients) {
    try {
      // eslint-disable-next-line no-await-in-loop
      results.push({ slug:client.slug, ...(await startClientInstance(client)) });
    } catch (err) {
      await ClientApp.updateOne({ slug:client.slug }, { $set:{ processStatus:'error', lastError:err.message } }).catch(()=>{});
      results.push({ slug:client.slug, ok:false, error:err.message });
    }
  }
  return results;
}

export function clientPublicUrl(req, slug){
  const safe = normalizeTenantSlug(slug);
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host') || '';
  return `${proto}://${host}/${safe}/`;
}

function stripClientPrefix(originalUrl, slug){
  const safe = normalizeTenantSlug(slug);
  const re = new RegExp(`^/${safe}(?=/|$)`);
  const stripped = String(originalUrl || '/').replace(re, '') || '/';
  return stripped.startsWith('/') ? stripped : '/' + stripped;
}


export async function proxyToClientInstanceApi(req, res, next){
  if (isChildInstance()) return next();
  let slug;
  try { slug = normalizeTenantSlug(req.params?.slug || ''); } catch { return next(); }
  if (!slug || slug === 'main') return res.status(400).json({ error:'Invalid client slug for API proxy' });

  const client = await ClientApp.findOne({ slug, enabled:true, mode:'instance' }).lean().catch(()=>null);
  if (!client?.port) return res.status(404).json({ error:`Client /${slug} not found or not enabled`, hint:'Open the main Clients tab and create/restart this client.' });

  const port = Number(client.port);
  const apiRemainder = req.url && req.url !== '/' ? req.url : '/';
  const targetPath = '/api' + apiRemainder;
  return proxyHttpToPort(req, res, port, targetPath, slug);
}

function proxyHttpToPort(req, res, port, targetPath, slug){
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  delete headers.connection;
  delete headers['content-length'];

  let body = null;
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
    body = Buffer.from(JSON.stringify(req.body));
    headers['content-type'] = headers['content-type'] || 'application/json';
    headers['content-length'] = String(body.length);
  }

  const configuredProxyTimeout = Number(process.env.CLIENT_PROXY_TIMEOUT_MS || 300000);
  const proxyTimeoutMs = Number.isFinite(configuredProxyTimeout)
    ? Math.max(120000, configuredProxyTimeout)
    : 300000;

  const proxyReq = http.request({
    host: '127.0.0.1',
    port,
    method: req.method,
    path: targetPath || '/',
    headers,
    timeout: proxyTimeoutMs
  }, proxyRes => {
    res.statusCode = proxyRes.statusCode || 502;
    for (const [k, v] of Object.entries(proxyRes.headers || {})) {
      if (typeof v !== 'undefined') res.setHeader(k, v);
    }
    proxyRes.pipe(res);
  });

  proxyReq.on('timeout', () => proxyReq.destroy(new Error('Client instance proxy timeout')));
  proxyReq.on('error', err => {
    if (res.headersSent) return;
    res.status(502).json({
      error: `Client instance /${slug} is not reachable on port ${port}`,
      detail: err.message,
      hint: `Open Clients tab and click Restart for /${slug}, or check ${logFile(slug)}`
    });
  });

  if (body) proxyReq.end(body);
  else req.pipe(proxyReq);
}

export async function proxyToClientInstance(req, res, next){
  if (isChildInstance()) return next();
  const first = (req.path || '/').split('/').filter(Boolean)[0] || '';
  if (!first) return next();
  let slug;
  try { slug = normalizeTenantSlug(first); } catch { return next(); }
  if (slug === 'main') return next();

  const client = await ClientApp.findOne({ slug, enabled:true, mode:'instance' }).lean().catch(()=>null);
  if (!client?.port) return next();

  if (req.path === `/${slug}`) return res.redirect(301, `/${slug}/`);

  const port = Number(client.port);
  const targetPath = stripClientPrefix(req.originalUrl, slug);
  return proxyHttpToPort(req, res, port, targetPath, slug);
}
