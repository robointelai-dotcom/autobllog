import express from 'express';
import Site from '../models/Site.js';
import JobLog from '../models/JobLog.js';
import { ensureSiteSchedule } from '../lib/jobs.js';
import { fetchWithTimeout, readBridgeResponse } from '../lib/http.js';
import { asyncHandler, cleanString, isObjectId, maskSite, normalizeSiteUrl, pickSitePatch, wpEndpoint } from '../lib/utils.js';

const router = express.Router();

router.get('/', asyncHandler(async (_req,res)=>{
  const items = await Site.find().sort({ createdAt: -1 });
  res.json(items.map(maskSite));
}));

router.post('/', asyncHandler(async (req,res)=>{
  const body = req.body || {};
  const name = cleanString(body.name, 120);
  const apiKey = cleanString(body.apiKey, 500);
  if (!name || !body.url || !apiKey) return res.status(400).json({ error:'name, url, apiKey required' });

  const created = await Site.create({ name, url: normalizeSiteUrl(body.url), apiKey, scheduleMode:'manual' });
  await ensureSiteSchedule(req.agenda, created, req.isManualOnly);
  res.status(201).json(maskSite(created));
}));

router.put('/:id', asyncHandler(async (req,res)=>{
  const id = req.params.id;
  if (!isObjectId(id)) return res.status(400).json({ error:'Invalid site id' });
  const patch = pickSitePatch(req.body || {});
  const updated = await Site.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
  if (!updated) return res.status(404).json({ error:'Site not found' });
  await ensureSiteSchedule(req.agenda, updated, req.isManualOnly);
  res.json(maskSite(updated));
}));

router.delete('/:id', asyncHandler(async (req,res)=>{
  const id = req.params.id;
  if (!isObjectId(id)) return res.status(400).json({ error:'Invalid site id' });
  await req.agenda.cancel({ name:'run-v5-bridge', 'data.siteId': id });
  const deleted = await Site.deleteOne({ _id: id });
  res.json({ ok:true, deleted: deleted.deletedCount });
}));

router.post('/:id/ping', asyncHandler(async (req,res)=>{
  const id = req.params.id;
  if (!isObjectId(id)) return res.status(400).json({ error:'Invalid site id' });
  const site = await Site.findById(id);
  if (!site) return res.status(404).json({ error:'Not found' });

  try{
    const u = wpEndpoint(site.url, '/wp-json/grb/v1/ping');
    const r = await fetchWithTimeout(u, { headers: { 'x-api-key': site.apiKey } }, Number(process.env.BRIDGE_TIMEOUT_MS || 15000));
    const data = await readBridgeResponse(r);
    await JobLog.create({ siteId: site._id, action:'ping', status:'success', message: typeof data === 'string' ? data : JSON.stringify(data), payload: typeof data === 'object' ? data : undefined });
    res.json(data);
  }catch(e){
    await JobLog.create({ siteId: site._id, action:'ping', status:'error', message: e.message, payload: e.payload });
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message, payload: e.payload });
  }
}));

export default router;
