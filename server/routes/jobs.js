import express from 'express';
import { asyncHandler, isObjectId } from '../lib/utils.js';

const router = express.Router();

router.post('/trigger', asyncHandler(async (req,res)=>{
  const { Site, JobLog } = req.models;
  const { siteId } = req.body || {};
  if (!isObjectId(siteId)) return res.status(400).json({ error:'valid siteId required' });
  const site = await Site.findById(siteId);
  if (!site) return res.status(404).json({ error:'site not found' });
  await req.agenda.now('run-v5-bridge', { siteId, tenantSlug: req.tenantSlug, force: true });
  await JobLog.create({ siteId, action:'run', status:'success', message:'Manual trigger enqueued' });
  res.json({ ok:true, message:'Manual trigger enqueued', tenantSlug: req.tenantSlug });
}));

export default router;
