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

import sitesRouter from './routes/sites.js';
import jobsRouter from './routes/jobs.js';
import logsRouter from './routes/logs.js';
import queueRouter from './routes/queue.js';
import historyRouter from './routes/history.js';
import { defineJobs } from './lib/jobs.js';
import { parseBoolean } from './lib/utils.js';
import { authRouter, requireDashboardAuth } from './lib/auth.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
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

app.use('/api/auth', authRouter);

// Lock all dashboard API routes behind the dashboard session. /api/auth/* and
// /api/healthz stay public so login and uptime checks work before authentication.
app.use('/api', (req, res, next) => {
  if (req.path === '/healthz') return next();
  return requireDashboardAuth(req, res, next);
});

const ADMIN_KEY = process.env.API_KEY || process.env.ADMIN_KEY || '';
app.use((req, res, next) => {
  if (!ADMIN_KEY || req.method === 'GET' || req.method === 'OPTIONS' || req.path.startsWith('/api/auth/')) return next();
  const key = req.get('x-admin-key') || req.query.key || (req.body && req.body.key);
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

const MONGO = process.env.MONGO_URI || process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/remotecontroller';
const PORT = Number(process.env.PORT || 4000);
const MANUAL_ONLY = parseBoolean(process.env.MANUAL_ONLY, false);

await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 10000, socketTimeoutMS: 45000 });
const agenda = new Agenda({
  db: { address: MONGO, collection: 'agendaJobs' },
  processEvery: process.env.SCAN_EVERY || '1 minute',
  maxConcurrency: Math.max(1, Number(process.env.AGENDA_MAX_CONCURRENCY || 20))
});
defineJobs(agenda);

app.use((req,_res,next)=>{ req.isManualOnly = MANUAL_ONLY; next(); });
app.use('/api/sites', (req,_res,next)=>{ req.agenda = agenda; next(); }, sitesRouter);
app.use('/api/jobs',  (req,_res,next)=>{ req.agenda = agenda; next(); }, jobsRouter);
app.use('/api/logs', logsRouter);
app.use('/api/queue', queueRouter);
app.use('/api/history', historyRouter);

function healthPayload(){
  return {
    ok:true,
    appVersion:'v11-dashboard-lock',
    manualOnly: MANUAL_ONLY,
    nodeEnv: process.env.NODE_ENV || 'development',
    serverTime: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    mongoReadyState: mongoose.connection.readyState
  };
}
app.get('/healthz', (_req,res)=> res.json(healthPayload()));
app.get('/api/healthz', (_req,res)=> res.json(healthPayload()));


app.use('/api', (req, res) => {
  res.status(404).json({
    error: `API route not found: ${req.method} ${req.originalUrl}`,
    appVersion: 'v11-dashboard-lock',
    hint: 'If you expected this route, the old Node process may still be running. Restart /opt/autoblog/server.'
  });
});

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
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

await agenda.start();
const server = app.listen(PORT, ()=> console.log('[api] listening on', PORT, 'manualOnly=', MANUAL_ONLY));

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
