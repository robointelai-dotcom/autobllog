
const withTimeout = async (url, opts={}, ms) => {
  const effectiveMs = ms ?? (opts.timeout ?? Number(process.env.BRIDGE_TIMEOUT_MS || 180000));
  const { timeout, ...rest } = opts;
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), effectiveMs);
  try {
    return await fetch(url, { ...rest, signal: ac.signal });
  } finally {
    clearTimeout(id);
  }
};

import AbortController from 'abort-controller';
import fetch from 'node-fetch';
import Site from '../models/Site.js';
import JobLog from '../models/JobLog.js';

function tzFor(site){
  return site?.timezone || process.env.DEFAULT_TIMEZONE || 'Asia/Colombo';
}

function isLikelyCron(s){ return typeof s==='string' && s.trim().split(/\s+/).length>=5 }


function toCronFromDaily(hhmm){
  const [hh, mm] = (hhmm || '00:00').split(':');
  return `${mm} ${hh} * * *`;
}

async function runV5Bridge(site){
  const endpoint = new URL('wp-json/grb/v1/run', site.url).toString();
  let res;
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    res = await withTimeout(endpoint, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-api-key': site.apiKey },
      body: JSON.stringify({ siteId: site._id, note: 'dashboard-schedule' })
    }, Number(process.env.BRIDGE_TIMEOUT_MS || 45000));
    break;
  } catch (e) {
    if (e && e.name === 'AbortError' && attempt < 2) {
      await new Promise(r => setTimeout(r, 1500));
      continue;
    }
    throw e;
  }
}
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  try { return JSON.parse(text) } catch { return { ok:true, text } }
}

export async function ensureSiteSchedule(agenda, site, manualOnly=false){
  const sid = site._id.toString();
  await agenda.cancel({ name: 'run-v5-bridge', 'data.siteId': sid });
  if (manualOnly || !site.enabled || site.scheduleMode==='manual') return;

  const job = agenda.create('run-v5-bridge', { siteId: sid });
  job.unique({ 'data.siteId': sid });

  const mode = site.scheduleMode;
  if (mode==='everySeconds' && site.everySeconds){
    job.repeatEvery(`${Math.max(1, Math.min(100000000, Number(site.everySeconds)))} seconds`, { skipImmediate: true });
  }else if (mode==='everyHours' && site.everyHours){
    job.repeatEvery(`${site.everyHours} hours`, { skipImmediate: true });
  }else if (mode==='dailyTime' && site.dailyAt){
    const cron = toCronFromDaily(site.dailyAt);
    job.repeatEvery(cron, { skipImmediate: true, timezone: tzFor(site) });
  }else if (mode==='cron' && site.scheduleCron){
    if (!isLikelyCron(site.scheduleCron)) throw new Error(`Invalid CRON: "${site.scheduleCron}"`);
    job.repeatEvery(site.scheduleCron, { skipImmediate: true, timezone: tzFor(site) });
  }else if (mode==='once' && site.onceAt){
    job.schedule(new Date(site.onceAt));
  }
  await job.save();
  if (process.env.RUN_IMMEDIATE_ON_SAVE === 'true' && mode !== 'once'){
    await agenda.now('run-v5-bridge', { siteId: sid, force: true });
  }
}

export function defineJobs(agenda){
  const CONC = Math.max(1, Number(process.env.JOB_CONCURRENCY || 5));
  agenda.define('run-v5-bridge', { concurrency: CONC, lockLifetime: 600000 }, async (job) => {
    const { siteId } = job.attrs.data || {};
    const site = await Site.findById(siteId);
    if (!site || !site.enabled) return;
    // Cooldown guard: prevent runs closer than configured seconds (protects against accidental rapid requeues)
    const force = job?.attrs?.data?.force === true;
    if (!force && site.scheduleMode === 'everySeconds' && site.everySeconds && site.lastSuccessAt) {
      const now = Date.now();
      const since = now - new Date(site.lastSuccessAt).getTime();
      const required = Number(site.everySeconds) * 1000;
      const drift = 5000; // 5s grace
      if (since < Math.max(0, required - drift)) {
        await JobLog.create({ siteId: site._id, action:'run', status:'skipped', message:`Cooldown: last success ${Math.round(since/1000)}s ago; need ${site.everySeconds}s.` });
        return;
      }
    }


    const fmtDay = (date, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit' }).format(date);
    const todayKey = fmtDay(new Date(), tzFor(site));
    if (site.dailyLimit && site.dailyLimit > 0){
      if (site.todayKey !== todayKey){
        site.todayKey = todayKey; site.todayCount = 0; await site.save();
      }
      if (site.todayCount >= site.dailyLimit){
        await JobLog.create({ siteId: site._id, action:'run', status:'success', message:`Daily limit ${site.dailyLimit} reached. Skipped.` });
        return;
      }
    }

    try{
      const out = await runV5Bridge(site);
      await JobLog.create({ siteId: site._id, action:'run', status:'success', message:`Posted via bridge`, payload: out });
      await Site.updateOne({ _id: site._id }, { $inc: { 'counters.sent': 1, todayCount: 1 }, $set:{ lastSuccessAt: new Date(), todayKey } });
    }catch(err){
      await JobLog.create({ siteId: site?._id, action:'run', status:'error', message: err.message });
      if (site) await Site.updateOne({ _id: site._id }, { $inc: { 'counters.failed': 1 } });
    }
  });
}
