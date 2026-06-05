import { fetchWithTimeout, readBridgeResponse } from './http.js';
import { DEFAULT_TENANT, getTenantModels, normalizeTenantSlug } from './tenants.js';
import { isValidTimeHHMM, isValidTimezone, wpEndpoint } from './utils.js';

function tzFor(site){
  const tz = site?.timezone || process.env.DEFAULT_TIMEZONE || 'Asia/Colombo';
  return isValidTimezone(tz) ? tz : 'UTC';
}

function isLikelyCron(s){
  if (typeof s !== 'string') return false;
  const parts = s.trim().split(/\s+/);
  return parts.length === 5 || parts.length === 6;
}

function toCronFromDaily(hhmm){
  if (!isValidTimeHHMM(hhmm)) throw new Error('Daily schedule must be HH:MM');
  const [hh, mm] = hhmm.split(':');
  return `${Number(mm)} ${Number(hh)} * * *`;
}

function clampNumber(value, min, max, fallback){
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function randomInt(min, max){
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

export function nextRandomHourlyDate(site, from = new Date()){
  const hours = clampNumber(site?.randomHours || site?.everyHours || 1, 1, 8760, 1);
  let minMinute = clampNumber(site?.randomMinuteMin, 0, 59, 0);
  let maxMinute = clampNumber(site?.randomMinuteMax, 0, 59, 59);
  if (maxMinute < minMinute) [minMinute, maxMinute] = [maxMinute, minMinute];

  // Schedule one run in the next N-hour block, but choose a random minute/second.
  // Example: N=1 means one post in the next hour, never at the same fixed minute.
  const when = new Date(from.getTime());
  when.setSeconds(0, 0);
  when.setHours(when.getHours() + hours, 0, 0, 0);
  when.setMinutes(randomInt(minMinute, maxMinute), randomInt(0, 50), 0);

  // Safety fallback if server clock or DST produces a past/too-close time.
  if (when.getTime() <= from.getTime() + 30_000) {
    when.setTime(from.getTime() + (hours * 60 * 60 * 1000) + randomInt(minMinute, maxMinute) * 60_000 + randomInt(0, 50) * 1000);
  }
  return when;
}

export async function scheduleNextRandomHourly(agenda, site, tenantSlug = DEFAULT_TENANT, note = 'random-hourly'){
  if (!agenda || !site?._id) return null;
  if (!site.enabled || !['randomHourly','randomHours'].includes(site.scheduleMode)) return null;
  const safeTenant = normalizeTenantSlug(tenantSlug);
  const sid = site._id.toString();
  const when = nextRandomHourlyDate(site);
  const job = agenda.create('run-v5-bridge-random-hourly', {
    siteId: sid,
    tenantSlug: safeTenant,
    randomHourly: true,
    scheduledBy: note,
    scheduledAt: new Date().toISOString()
  });
  job.unique({ name: 'run-v5-bridge-random-hourly', 'data.siteId': sid, 'data.tenantSlug': safeTenant, 'data.randomHourly': true }, { insertOnly: false });
  job.schedule(when);
  await job.save();
  const { Site, JobLog } = getTenantModels(safeTenant);
  await Site.updateOne({ _id: site._id }, { $set: { nextRandomRunAt: when } }).catch(()=>{});
  await JobLog.create({ siteId: site._id, action:'schedule', status:'success', message:`Random hourly next run: ${when.toISOString()} (${site.randomHours || 1}h interval, minute ${site.randomMinuteMin ?? 0}-${site.randomMinuteMax ?? 59})` }).catch(()=>{});
  return when;
}

async function runV5Bridge(site, tenantSlug, note = 'dashboard-schedule'){
  const endpoint = wpEndpoint(site.url, '/wp-json/grb/v1/run');
  const attempts = Math.max(1, Math.min(5, Number(process.env.BRIDGE_RETRIES || 2)));
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetchWithTimeout(endpoint, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'x-api-key': site.apiKey },
        body: JSON.stringify({ siteId: site._id.toString(), note, tenantSlug })
      }, Number(process.env.BRIDGE_TIMEOUT_MS || 45000));
      return await readBridgeResponse(res);
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr;
}

export async function ensureSiteSchedule(agenda, site, manualOnly=false, tenantSlug=DEFAULT_TENANT){
  if (!site?._id) return;
  const safeTenant = normalizeTenantSlug(tenantSlug);
  const { JobLog, Site } = getTenantModels(safeTenant);
  const sid = site._id.toString();
  await agenda.cancel({ name: 'run-v5-bridge', 'data.siteId': sid, 'data.tenantSlug': safeTenant });
  await agenda.cancel({ name: 'run-v5-bridge-random-hourly', 'data.siteId': sid, 'data.tenantSlug': safeTenant });
  await Site.updateOne({ _id: site._id }, { $set: { nextRandomRunAt: null } }).catch(()=>{});

  if (manualOnly || !site.enabled || site.scheduleMode === 'manual') {
    await JobLog.create({ siteId: site._id, action:'schedule', status:'success', message:'Schedule disabled/manual.' }).catch(()=>{});
    return;
  }

  const mode = site.scheduleMode;

  if (mode === 'randomHourly' || mode === 'randomHours') {
    await scheduleNextRandomHourly(agenda, site, safeTenant, 'schedule-save');
    await JobLog.create({ siteId: site._id, action:'schedule', status:'success', message:`Random hourly schedule saved: 1 post every ${site.randomHours || 1} hour(s), random minute ${site.randomMinuteMin ?? 0}-${site.randomMinuteMax ?? 59}.` }).catch(()=>{});
    return;
  }

  const job = agenda.create('run-v5-bridge', { siteId: sid, tenantSlug: safeTenant });
  job.unique({ 'data.siteId': sid, 'data.tenantSlug': safeTenant }, { insertOnly: true });

  if (mode === 'everySeconds') {
    const seconds = Math.max(1, Math.min(100000000, Number(site.everySeconds || 0)));
    if (!seconds) throw new Error('Every seconds value is required');
    job.repeatEvery(`${seconds} seconds`, { skipImmediate: true });
  } else if (mode === 'everyHours') {
    const hours = Math.max(1, Math.min(8760, Number(site.everyHours || 0)));
    if (!hours) throw new Error('Every hours value is required');
    job.repeatEvery(`${hours} hours`, { skipImmediate: true });
  } else if (mode === 'dailyTime') {
    const cron = toCronFromDaily(site.dailyAt);
    job.repeatEvery(cron, { skipImmediate: true, timezone: tzFor(site) });
  } else if (mode === 'cron') {
    if (!isLikelyCron(site.scheduleCron)) throw new Error(`Invalid CRON: "${site.scheduleCron || ''}"`);
    job.repeatEvery(site.scheduleCron.trim(), { skipImmediate: true, timezone: tzFor(site) });
  } else if (mode === 'once') {
    const when = site.onceAt ? new Date(site.onceAt) : null;
    if (!when || Number.isNaN(when.getTime())) throw new Error('Once date/time is required');
    job.schedule(when);
  } else {
    throw new Error(`Unsupported schedule mode: ${mode}`);
  }

  await job.save();
  await JobLog.create({ siteId: site._id, action:'schedule', status:'success', message:`Schedule saved: ${mode}` }).catch(()=>{});
  if (process.env.RUN_IMMEDIATE_ON_SAVE === 'true' && mode !== 'once') await agenda.now('run-v5-bridge', { siteId: sid, tenantSlug: safeTenant, force: true });
}

async function executeBridgeRun({ siteId, tenantSlug = DEFAULT_TENANT, force = false, note = 'dashboard-schedule' }){
  const safeTenant = normalizeTenantSlug(tenantSlug);
  const { Site, JobLog } = getTenantModels(safeTenant);
  const site = await Site.findById(siteId);
  if (!site || !site.enabled) return { skipped: true, reason: 'site disabled or missing' };

  if (!force && site.scheduleMode === 'everySeconds' && site.everySeconds && site.lastSuccessAt) {
    const since = Date.now() - new Date(site.lastSuccessAt).getTime();
    const required = Number(site.everySeconds) * 1000;
    if (since < Math.max(0, required - 5000)) {
      await JobLog.create({ siteId: site._id, action:'run', status:'skipped', message:`Cooldown: last success ${Math.round(since/1000)}s ago; need ${site.everySeconds}s.` });
      return { skipped: true, reason: 'cooldown' };
    }
  }

  const fmtDay = (date, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit' }).format(date);
  const todayKey = fmtDay(new Date(), tzFor(site));
  if (site.dailyLimit && site.dailyLimit > 0){
    if (site.todayKey !== todayKey){ site.todayKey = todayKey; site.todayCount = 0; await site.save(); }
    if (site.todayCount >= site.dailyLimit){
      await JobLog.create({ siteId: site._id, action:'run', status:'skipped', message:`Daily limit ${site.dailyLimit} reached.` });
      return { skipped: true, reason: 'daily-limit' };
    }
  }

  try{
    const out = await runV5Bridge(site, safeTenant, note);
    const resultStatus = out?.result?.status || out?.status || '';
    if (resultStatus === 'skipped') {
      await JobLog.create({ siteId: site._id, action:'run', status:'skipped', message: out?.result?.message || out?.message || 'Bridge skipped run', payload: out });
      return { skipped: true, reason: 'bridge-skipped', payload: out };
    }
    await JobLog.create({ siteId: site._id, action:'run', status:'success', message: out?.message || out?.result?.title || 'Posted via bridge', payload: out });
    await Site.updateOne({ _id: site._id }, { $inc: { 'counters.sent': 1, todayCount: 1 }, $set:{ lastSuccessAt: new Date(), todayKey }, $unset:{ lastErrorAt: '' } });
    return { ok: true, payload: out };
  }catch(err){
    await JobLog.create({ siteId: site._id, action:'run', status:'error', message: err.message, payload: err.payload });
    await Site.updateOne({ _id: site._id }, { $inc: { 'counters.failed': 1 }, $set: { lastErrorAt: new Date() } });
    throw err;
  }
}

export function defineJobs(agenda){
  const CONC = Math.max(1, Math.min(100, Number(process.env.JOB_CONCURRENCY || process.env.PUSH_CONCURRENCY || 5)));
  const lockLifetime = Math.max(60000, Number(process.env.AGENDA_LOCK_MS || 600000));

  agenda.define('run-v5-bridge', { concurrency: CONC, lockLifetime }, async (job) => {
    const { siteId, tenantSlug = DEFAULT_TENANT, force = false } = job.attrs.data || {};
    await executeBridgeRun({ siteId, tenantSlug, force, note: force ? 'manual-trigger' : 'dashboard-schedule' });
  });

  agenda.define('run-v5-bridge-random-hourly', { concurrency: CONC, lockLifetime }, async (job) => {
    const { siteId, tenantSlug = DEFAULT_TENANT } = job.attrs.data || {};
    const safeTenant = normalizeTenantSlug(tenantSlug);
    try {
      await executeBridgeRun({ siteId, tenantSlug: safeTenant, force: false, note: 'dashboard-random-hourly' });
    } finally {
      const { Site } = getTenantModels(safeTenant);
      const latest = await Site.findById(siteId).catch(()=>null);
      if (latest && latest.enabled && ['randomHourly','randomHours'].includes(latest.scheduleMode)) {
        await scheduleNextRandomHourly(agenda, latest, safeTenant, 'after-run');
      }
    }
  });
}
