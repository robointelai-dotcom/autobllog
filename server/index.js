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
import { authRouter, requireDashboardAuth } from './lib/auth.js';
import { DEFAULT_TENANT, ensureDefaultClientRecord, tenantMiddleware } from './lib/tenants.js';

const APP_VERSION = 'v12-multi-client-isolated-db';
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));

const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb){
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS blocked'));
  },
  credentials: true
}));

app.use(rateLimit({ windowMs: 60_000, max: Number(process.env.RATE_LIMIT_PER_MIN || 240), standardHeaders: true, legacyHeaders: false }));
app.use(express.json({ limit: process.env.JSON_LIMIT || '64mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const MONGO = process.env.MONGO_URI || process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/remotecontroller';
const PORT = Number(process.env.PORT || 4000);
const MANUAL_ONLY = parseBoolean(process.env.MANUAL_ONLY, false);
const ADMIN_KEY = process.env.API_KEY || process.env.ADMIN_KEY || '';

await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 10000, socketTimeoutMS: 45000 });
await ensureDefaultClientRecord();

const agenda = new Agenda({
  db: { address: MONGO, collection: 'agendaJobs' },
  processEvery: process.env.SCAN_EVERY || '1 minute',
  maxConcurrency: Math.max(1, Number(process.env.AGENDA_MAX_CONCURRENCY || 20))
});
defineJobs(agenda);

function healthPayload(req){
  return {
    ok:true,
    appVersion: APP_VERSION,
    tenantSlug: req?.tenantSlug || DEFAULT_TENANT,
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
  const key = req.get('x-admin-key') || req.query.key || (req.body && req.body.key);
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

  router.use('/clients', clientsRouter);
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

// IMPORTANT: mount tenant API before default /api, otherwise /api/t/:tenant is swallowed by /api.
mountApi('/api/t/:tenant', req => req.params.tenant);
mountApi('/api', () => DEFAULT_TENANT);

app.get('/healthz', (_req,res)=> res.json(healthPayload()));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.join(__dirname, '../client/dist');
app.use('/', express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), err => err && next());
});

app.use((err, _req, res, _next) => {
  console.error('[api-error]', err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.message || 'Server error', appVersion: APP_VERSION });
});

await agenda.start();
const server = app.listen(PORT, ()=> console.log('[api] listening on', PORT, 'version=', APP_VERSION, 'manualOnly=', MANUAL_ONLY));

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
