import Site from '../models/Site.js';
import JobLog from '../models/JobLog.js';
import { fetchWithTimeout, readBridgeResponse } from './http.js';
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

async function runV5Bridge(site){
  const endpoint = wpEndpoint(site.url, '/wp-json/grb/v1/run');
  const attempts = Math.max(1, Math.min(5, Number(process.env.BRIDGE_RETRIES || 2)));
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetchWithTimeout(endpoint, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'x-api-key': site.apiKey },
        body: JSON.stringify({ siteId: site._id.toString(), note: 'dashboard-schedule' })
      }, Number(process.env.BRIDGE_TIMEOUT_MS || 45000));
      return await readBridgeResponse(res);
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr;
}

export async function ensureSiteSchedule(agenda, site, manualOnly=false){
  if (!site?._id) return;
  const sid = site._id.toString();
  await agenda.cancel({ name: 'run-v5-bridge', 'data.siteId': sid });
  if (manualOnly || !site.enabled || site.scheduleMode === 'manual') {
    await JobLog.create({ siteId: site._id, action:'schedule', status:'success', message:'Schedule disabled/manual.' }).catch(()=>{});
    return;
  }

  const mode = site.scheduleMode;
  const job = agenda.create('run-v5-bridge', { siteId: sid });
  job.unique({ 'data.siteId': sid }, { insertOnly: true });

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

  if (process.env.RUN_IMMEDIATE_ON_SAVE === 'true' && mode !== 'once') {
    await agenda.now('run-v5-bridge', { siteId: sid, force: true });
  }
}

export function defineJobs(agenda){
  const CONC = Math.max(1, Math.min(100, Number(process.env.JOB_CONCURRENCY || process.env.PUSH_CONCURRENCY || 5)));
  const lockLifetime = Math.max(60000, Number(process.env.AGENDA_LOCK_MS || 600000));

  agenda.define('run-v5-bridge', { concurrency: CONC, lockLifetime }, async (job) => {
    const { siteId, force = false } = job.attrs.data || {};
    const site = await Site.findById(siteId);
    if (!site || !site.enabled) return;

    if (!force && site.scheduleMode === 'everySeconds' && site.everySeconds && site.lastSuccessAt) {
      const since = Date.now() - new Date(site.lastSuccessAt).getTime();
      const required = Number(site.everySeconds) * 1000;
      if (since < Math.max(0, required - 5000)) {
        await JobLog.create({ siteId: site._id, action:'run', status:'skipped', message:`Cooldown: last success ${Math.round(since/1000)}s ago; need ${site.everySeconds}s.` });
        return;
      }
    }

    const fmtDay = (date, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit' }).format(date);
    const todayKey = fmtDay(new Date(), tzFor(site));
    if (site.dailyLimit && site.dailyLimit > 0){
      if (site.todayKey !== todayKey){
        site.todayKey = todayKey;
        site.todayCount = 0;
        await site.save();
      }
      if (site.todayCount >= site.dailyLimit){
        await JobLog.create({ siteId: site._id, action:'run', status:'skipped', message:`Daily limit ${site.dailyLimit} reached.` });
        return;
      }
    }

    try{
      const out = await runV5Bridge(site);
      const resultStatus = out?.result?.status || out?.status || '';
      if (resultStatus === 'skipped') {
        await JobLog.create({ siteId: site._id, action:'run', status:'skipped', message: out?.result?.message || out?.message || 'Bridge skipped run', payload: out });
        return;
      }
      await JobLog.create({ siteId: site._id, action:'run', status:'success', message: out?.message || out?.result?.title || 'Posted via bridge', payload: out });
      await Site.updateOne({ _id: site._id }, { $inc: { 'counters.sent': 1, todayCount: 1 }, $set:{ lastSuccessAt: new Date(), todayKey }, $unset:{ lastErrorAt: '' } });
    }catch(err){
      await JobLog.create({ siteId: site._id, action:'run', status:'error', message: err.message, payload: err.payload });
      await Site.updateOne({ _id: site._id }, { $inc: { 'counters.failed': 1 }, $set: { lastErrorAt: new Date() } });
    }
  });
}
