import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import mongoose from 'mongoose';
import ClientApp from '../models/ClientApp.js';
import { normalizeTenantSlug, tenantDbName } from './tenants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '../..');
const SERVER_INDEX = path.join(APP_ROOT, 'server', 'index.js');
const SERVER_DATA = path.join(APP_ROOT, 'server', 'data');
const INSTANCE_ROOT = process.env.CLIENT_INSTANCE_ROOT || '/opt/autoblog-clients';
const PORT_BASE = Number(process.env.CLIENT_PORT_BASE || 4100);
const PORT_MAX = Number(process.env.CLIENT_PORT_MAX || 4999);
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

function portIsOpen(port){
  return new Promise(resolve => {
    const req = http.request({ host:'127.0.0.1', port, path:'/api/healthz', method:'GET', timeout:1200 }, res => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
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
        try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: JSON.parse(raw || '{}') }); }
        catch { resolve({ ok:false, status:res.statusCode, data:raw }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok:false, error:'timeout' }); });
    req.on('error', err => resolve({ ok:false, error:err.message }));
    req.end();
  });
}

export async function startClientInstance(client){
  const slug = normalizeTenantSlug(client.slug);
  const port = Number(client.port);
  if (!port) throw new Error(`Client ${slug} has no assigned port`);
  if (isChildInstance()) throw new Error('Child instances cannot start other instances');

  const already = await checkInstanceHealth(port);
  if (already.ok) {
    await ClientApp.updateOne({ slug }, { $set: { processStatus:'running', lastStartedAt:new Date(), lastError:'' } }).catch(()=>{});
    return { ok:true, alreadyRunning:true, port, pid:client.processPid || null };
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

  const child = spawn(process.execPath, [SERVER_INDEX], {
    cwd: path.join(APP_ROOT, 'server'),
    env: childEnv,
    detached: true,
    stdio: ['ignore', out, out]
  });
  child.unref();
  fs.writeFileSync(path.join(dir, 'run.pid'), String(child.pid));
  await ClientApp.updateOne({ slug }, { $set: { processPid: child.pid, processStatus:'starting', lastStartedAt:new Date(), lastError:'' } }).catch(()=>{});

  // Give it a few seconds to bind the port.
  for (let i=0;i<12;i++) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise(r => setTimeout(r, 500));
    // eslint-disable-next-line no-await-in-loop
    const health = await checkInstanceHealth(port);
    if (health.ok) {
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
  const body = req.body && Object.keys(req.body).length ? Buffer.from(JSON.stringify(req.body)) : null;
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  delete headers.connection;
  delete headers['content-length'];
  if (body) {
    headers['content-type'] = headers['content-type'] || 'application/json';
    headers['content-length'] = String(body.length);
  }

  const proxyReq = http.request({ host:'127.0.0.1', port, method:req.method, path:targetPath, headers, timeout:120000 }, proxyRes => {
    res.statusCode = proxyRes.statusCode || 502;
    for (const [k,v] of Object.entries(proxyRes.headers)) {
      if (typeof v !== 'undefined') res.setHeader(k, v);
    }
    proxyRes.pipe(res);
  });
  proxyReq.on('timeout', () => proxyReq.destroy(new Error('Client instance proxy timeout')));
  proxyReq.on('error', err => {
    if (!res.headersSent) res.status(502).json({ error:`Client instance /${slug} is not reachable on port ${port}`, detail:err.message, hint:'Open Clients tab and restart the client instance, or check /opt/autoblog-clients/<slug>/logs/server.log' });
  });
  if (body) proxyReq.end(body);
  else req.pipe(proxyReq);
}
