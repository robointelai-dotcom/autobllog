import express from 'express';
import Site from '../models/Site.js';
import JobLog from '../models/JobLog.js';
import { fetchWithTimeout, readBridgeResponse } from '../lib/http.js';
import { asyncHandler, isObjectId, validateQueueItems, wpEndpoint } from '../lib/utils.js';

const router = express.Router();

async function findSiteOr404(siteId, res){
  if (!isObjectId(siteId)) {
    res.status(400).json({ error:'valid siteId required' });
    return null;
  }
  const site = await Site.findById(siteId);
  if (!site) {
    res.status(404).json({ error:'site not found' });
    return null;
  }
  return site;
}

router.get('/', asyncHandler(async (req,res)=>{
  const site = await findSiteOr404(req.query.siteId, res);
  if (!site) return;
  const u = wpEndpoint(site.url, '/wp-json/grb/v1/queue');
  const r = await fetchWithTimeout(u, { headers:{ 'x-api-key': site.apiKey } }, Number(process.env.BRIDGE_TIMEOUT_MS || 30000));
  res.json(await readBridgeResponse(r));
}));

router.post('/append', asyncHandler(async (req,res)=>{
  let items;
  try { items = validateQueueItems(req.body?.items); }
  catch (e) { return res.status(e.status || 400).json({ error:e.message }); }
  const site = await findSiteOr404(req.body?.siteId, res);
  if (!site) return;
  const u = wpEndpoint(site.url, '/wp-json/grb/v1/queue/append');
  const r = await fetchWithTimeout(u, {
    method:'POST', headers:{ 'Content-Type':'application/json', 'x-api-key': site.apiKey },
    body: JSON.stringify({ items })
  }, Number(process.env.BRIDGE_TIMEOUT_MS || 45000));
  const data = await readBridgeResponse(r);
  await JobLog.create({ siteId: site._id, action:'queue-bulk', status:'success', message:`Uploaded ${items.length} queue rows`, payload: data });
  res.json(data);
}));


router.post('/sync', asyncHandler(async (req,res)=>{
  let items;
  try { items = validateQueueItems(req.body?.items); }
  catch (e) { return res.status(e.status || 400).json({ error:e.message }); }
  const site = await findSiteOr404(req.body?.siteId, res);
  if (!site) return;
  const allowedModes = new Set(['smart','append','replace','mirror']);
  const mode = allowedModes.has(req.body?.mode) ? req.body.mode : 'smart';
  const skipPublished = req.body?.skipPublished !== false;
  const u = wpEndpoint(site.url, '/wp-json/grb/v1/queue/sync');
  const r = await fetchWithTimeout(u, {
    method:'POST', headers:{ 'Content-Type':'application/json', 'x-api-key': site.apiKey },
    body: JSON.stringify({ items, mode, skipPublished })
  }, Number(process.env.BRIDGE_TIMEOUT_MS || 60000));
  const data = await readBridgeResponse(r);
  await JobLog.create({ siteId: site._id, action:'queue-sync', status:'success', message:`CSV ${mode}: added ${data.added ?? 0}, updated ${data.updated ?? 0}, removed ${data.removed ?? 0}, queue ${data.queueCount ?? '?'}`, payload: data });
  res.json(data);
}));

router.post('/clear', asyncHandler(async (req,res)=>{
  const site = await findSiteOr404(req.body?.siteId, res);
  if (!site) return;
  const u = wpEndpoint(site.url, '/wp-json/grb/v1/queue/clear');
  const r = await fetchWithTimeout(u, {
    method:'POST', headers:{ 'Content-Type':'application/json', 'x-api-key': site.apiKey },
    body: JSON.stringify({ all: true })
  }, Number(process.env.BRIDGE_TIMEOUT_MS || 30000));
  res.json(await readBridgeResponse(r));
}));

export default router;
