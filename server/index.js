import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import mongoose from 'mongoose';
import Agenda from 'agenda';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';

import clientsRouter from './routes/clients.js';
import sitesRouter from './routes/sites.js';
import jobsRouter from './routes/jobs.js';
import logsRouter from './routes/logs.js';
import queueRouter from './routes/queue.js';
import historyRouter from './routes/history.js';
import { defineJobs } from './lib/jobs.js';
import { parseBoolean } from './lib/utils.js';
import { redactSecrets } from './lib/http.js';
import { authRouter, requireDashboardAuth } from './lib/auth.js';
import { DEFAULT_TENANT, ensureDefaultClientRecord, tenantMiddleware } from './lib/tenants.js';
import { currentInstanceSlug, isChildInstance, proxyToClientInstance, proxyToClientInstanceApi, startAllClientInstances } from './lib/instances.js';

const APP_VERSION = 'v18.3-deep-stability-fix';

function finiteNumber(value, fallback, min = -Infinity, max = Infinity){
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const INSTANCE_CHILD = isChildInstance();
const INSTANCE_SLUG = currentInstanceSlug();
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));

const allowedOrigins = new Set((process.env.CORS_ORIGINS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean));
app.use(cors((req, cb) => {
  const origin = String(req.get('origin') || '').replace(/\/$/, '');
  if (!origin) return cb(null, { origin: false, credentials: true });
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol || 'http';
  const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
  const host = forwardedHost || req.get('host') || '';
  const sameOrigin = host && origin === `${proto}://${host}`;
  const allowed = sameOrigin || allowedOrigins.has(origin);
  if (!allowed) {
    const err = new Error('CORS origin blocked');
    err.status = 403;
    return cb(err);
  }
  return cb(null, { origin, credentials: true });
}));

app.use(rateLimit({ windowMs: 60_000, max: finiteNumber(process.env.RATE_LIMIT_PER_MIN, 240, 10, 100000), standardHeaders: true, legacyHeaders: false }));
// Keep ordinary API requests reasonably small, but allow the dedicated plugin
// upload route to carry a base64 ZIP. A 60 MB ZIP is about 80 MB as base64.
const standardJsonParser = express.json({ limit: process.env.JSON_LIMIT || '16mb' });
const pluginUploadJsonParser = express.json({ limit: process.env.PLUGIN_UPLOAD_JSON_LIMIT || '96mb' });
app.use((req, res, next) => {
  const isPluginUpload = /\/plugins\/upload(?:\?|$)/i.test(req.originalUrl || req.url || '');
  return (isPluginUpload ? pluginUploadJsonParser : standardJsonParser)(req, res, next);
});
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const MONGO = process.env.MONGO_URI || process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/remotecontroller';
const PORT = finiteNumber(process.env.PORT, 4000, 1, 65535);
const MANUAL_ONLY = parseBoolean(process.env.MANUAL_ONLY, false);
const ADMIN_KEY = process.env.API_KEY || process.env.ADMIN_KEY || '';

await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 10000, socketTimeoutMS: 45000 });
await ensureDefaultClientRecord();

const agenda = new Agenda({
  db: { address: MONGO, collection: 'agendaJobs' },
  processEvery: process.env.SCAN_EVERY || '1 minute',
  maxConcurrency: finiteNumber(process.env.AGENDA_MAX_CONCURRENCY, 20, 1, 100)
});
defineJobs(agenda);

function healthPayload(req){
  return {
    ok:true,
    appVersion: APP_VERSION,
    tenantSlug: INSTANCE_CHILD ? INSTANCE_SLUG : (req?.tenantSlug || DEFAULT_TENANT),
    instanceMode: INSTANCE_CHILD ? 'child-dedicated-backend' : 'main-router-backend',
    instanceSlug: INSTANCE_SLUG,
    tenantDatabaseName: req?.tenantDatabaseName || mongoose.connection.name,
    manualOnly: MANUAL_ONLY,
    nodeEnv: process.env.NODE_ENV || 'development',
    serverTime: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    mongoReadyState: mongoose.connection.readyState
  };
}

function adminKeyGuard(req, res, next){
  if (!ADMIN_KEY || req.method === 'GET' || req.method === 'OPTIONS' || req.path.startsWith('/auth/')) return next();
  const key = req.get('x-admin-key') || '';
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function mountApi(prefix, tenantGetter){
  const router = express.Router({ mergeParams: true });
  router.use(tenantMiddleware(tenantGetter));
  router.use((req,_res,next)=>{ req.isManualOnly = MANUAL_ONLY; next(); });

  router.get('/healthz', (req,res)=> res.json(healthPayload(req)));
  router.use('/auth', authRouter);

  // Lock all tenant dashboard API routes behind that tenant's session.
  router.use((req, res, next) => requireDashboardAuth(req, res, next));
  router.use(adminKeyGuard);

  if (!INSTANCE_CHILD) {
    router.use('/clients', clientsRouter);
  } else {
    router.use('/clients', (_req, res) => res.status(403).json({ error: 'Client builder is available only in the main dashboard. This is a fresh client backend instance.', appVersion: APP_VERSION, instanceSlug: INSTANCE_SLUG }));
  }
  router.use('/sites', (req,_res,next)=>{ req.agenda = agenda; next(); }, sitesRouter);
  router.use('/jobs',  (req,_res,next)=>{ req.agenda = agenda; next(); }, jobsRouter);
  router.use('/logs', logsRouter);
  router.use('/queue', queueRouter);
  router.use('/history', historyRouter);

  router.use((req, res) => {
    res.status(404).json({
      error: `API route not found: ${req.method} ${req.originalUrl}`,
      appVersion: APP_VERSION,
      tenantSlug: req.tenantSlug,
      hint: 'If you expected this route, update GitHub/server and restart /opt/autoblog/server.'
    });
  });

  app.use(prefix, router);
}

// v18.3 keeps fresh backend instances, safer client routing, and random hourly scheduling.
// Client API calls go through /api/_client/:slug/*, then the main backend proxies to that client's dedicated Node process.
// This keeps /new/ working even when Nginx serves the React build statically instead of proxying every path to Node.
if (!INSTANCE_CHILD) {
  app.use('/api/_client/:slug', proxyToClientInstanceApi);
}
mountApi('/api', () => DEFAULT_TENANT);

app.get('/healthz', (_req,res)=> res.json(healthPayload()));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.join(__dirname, '../client/dist');

// In the main dashboard process only, route /client-slug/* to that client's dedicated backend process.
app.use(proxyToClientInstance);

app.use('/', express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), err => err && next());
});

app.use((err, _req, res, _next) => {
  const safeErrorForLog = redactSecrets({
    name: err?.name,
    message: err?.message,
    code: err?.code,
    status: err?.status || err?.statusCode,
    payload: err?.payload,
    stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack
  });
  console.error('[api-error]', safeErrorForLog);
  if (res.headersSent) return;

  let status = Number(err?.status || err?.statusCode || 500);
  let message = redactSecrets(err?.message || 'Server error');
  if (err?.code === 11000) {
    status = 409;
    const field = Object.keys(err?.keyPattern || err?.keyValue || {})[0];
    message = field ? `A record with this ${field} already exists.` : 'This record already exists.';
  } else if (err?.name === 'ValidationError' || err?.name === 'CastError') {
    status = 400;
    message = err?.message || 'Invalid request data.';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    message = 'Request body is too large.';
  } else if (err instanceof SyntaxError && 'body' in err) {
    status = 400;
    message = 'Request body contains invalid JSON.';
  }
  if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;
  res.status(status).json({ error: message, appVersion: APP_VERSION });
});

await agenda.start();
const server = app.listen(PORT, async ()=> {
  console.log('[api] listening on', PORT, 'version=', APP_VERSION, 'instanceChild=', INSTANCE_CHILD, 'instanceSlug=', INSTANCE_SLUG, 'manualOnly=', MANUAL_ONLY);
  if (!INSTANCE_CHILD) {
    const started = await startAllClientInstances().catch(err => ({ error: err.message }));
    if (Array.isArray(started) && started.length) console.log('[instances] auto-start results', started);
    else if (started?.error) console.error('[instances] auto-start error', started.error);
  }
});

async function shutdown(signal){
  console.log(`[api] ${signal} received, shutting down...`);
  server.close(async () => {
    await agenda.stop().catch(()=>{});
    await mongoose.disconnect().catch(()=>{});
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
