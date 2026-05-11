import express from 'express';
import Site from '../models/Site.js';
import { ensureSiteSchedule } from '../lib/jobs.js';
import fetch from 'node-fetch';
import JobLog from '../models/JobLog.js';

const router = express.Router();

router.get('/', async (_req,res)=>{
  const items = await Site.find().sort({ createdAt: -1 });
  res.json(items);
});

router.post('/', async (req,res)=>{
  const { name, url, apiKey } = req.body || {};
  if (!name || !url || !apiKey) return res.status(400).json({ error:'name, url, apiKey required' });
  const created = await Site.create({ name, url, apiKey, scheduleMode:'manual' });
  await ensureSiteSchedule(req.agenda, created, req.isManualOnly);
  res.json(created);
});

router.put('/:id', async (req,res)=>{
  const id = req.params.id;
  const updated = await Site.findByIdAndUpdate(id, req.body, { new: true });
  await ensureSiteSchedule(req.agenda, updated, req.isManualOnly);
  if (process.env.RUN_IMMEDIATE_ON_SAVE === 'true' && updated?.enabled && updated?.scheduleMode !== 'manual'){
    await req.agenda.now('run-v5-bridge', { siteId: updated._id.toString(), force: true });
  }
  res.json(updated);
});

router.delete('/:id', async (req,res)=>{
  const id = req.params.id;
  await req.agenda.cancel({ name:'run-v5-bridge', 'data.siteId': id });
  await Site.deleteOne({ _id: id });
  res.json({ ok:true });
});

router.post('/:id/ping', async (req,res)=>{
  const site = await Site.findById(req.params.id);
  if (!site) return res.status(404).json({ error:'Not found' });
  try{
    const u = new URL('wp-json/grb/v1/ping', site.url).toString();
    const r = await fetch(u, { headers: { 'x-api-key': site.apiKey }, timeout: 15000 });
    const txt = await r.text();
    await JobLog.create({ siteId: site._id, action:'ping', status: r.ok?'success':'error', message: txt });
    res.status(r.ok?200:500).send(txt);
  }catch(e){
    await JobLog.create({ siteId: site._id, action:'ping', status:'error', message: e.message });
    res.status(500).send(e.message);
  }
});

export default router;
