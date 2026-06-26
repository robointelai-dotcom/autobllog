import express from 'express';
import { fetchWithTimeout, readBridgeResponse } from '../lib/http.js';
import { asyncHandler, isObjectId, wpEndpoint } from '../lib/utils.js';

const router = express.Router();

async function findSite(req, siteId){
  const { Site } = req.models;
  if (!isObjectId(siteId)) { const err = new Error('valid siteId required'); err.status = 400; throw err; }
  const site = await Site.findById(siteId);
  if (!site) { const err = new Error('site not found'); err.status = 404; throw err; }
  return site;
}

async function callBridgeHistory(site, limit){
  const timeoutValue = Number(process.env.BRIDGE_TIMEOUT_MS || 30000);
  const timeout = Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : 30000;
  const limitValue = Number(limit || 100);
  const safeLimit = Number.isFinite(limitValue) ? Math.max(1, Math.min(500, limitValue)) : 100;
  const primary = wpEndpoint(site.url, `/wp-json/grb/v1/history?limit=${safeLimit}`);
  try {
    const r = await fetchWithTimeout(primary, { headers:{ 'x-api-key': site.apiKey } }, timeout);
    return await readBridgeResponse(r);
  } catch (err) {
    const fallback = wpEndpoint(site.url, '/wp-json/grb/v1/status');
    const r = await fetchWithTimeout(fallback, { headers:{ 'x-api-key': site.apiKey } }, timeout);
    const data = await readBridgeResponse(r);
    return { ok:true, history: Array.isArray(data.history) ? data.history : [], queueCount:data.queueCount, lastError:data.lastError, source:'status-fallback' };
  }
}

router.get('/', asyncHandler(async (req,res)=>{
  const { JobLog } = req.models;
  const site = await findSite(req, req.query.siteId);
  try {
    const data = await callBridgeHistory(site, req.query.limit);
    const rows = Array.isArray(data.history) ? data.history : [];
    await JobLog.create({ siteId: site._id, action:'history', status:'success', message:`Loaded ${rows.length} blog history rows`, payload:{ queueCount:data.queueCount, source:data.source || 'history' } }).catch(()=>{});
    res.json(data);
  } catch (e) {
    await JobLog.create({ siteId: site._id, action:'history', status:'error', message:e.message, payload:e.payload }).catch(()=>{});
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error:e.message, payload:e.payload });
  }
}));

export default router;
