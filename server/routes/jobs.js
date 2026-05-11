import express from 'express';
import Site from '../models/Site.js';
import JobLog from '../models/JobLog.js';
import { asyncHandler, isObjectId } from '../lib/utils.js';

const router = express.Router();

router.post('/trigger', asyncHandler(async (req,res)=>{
  const { siteId } = req.body || {};
  if (!isObjectId(siteId)) return res.status(400).json({ error:'valid siteId required' });
  const site = await Site.findById(siteId);
  if (!site) return res.status(404).json({ error:'site not found' });
  await req.agenda.now('run-v5-bridge', { siteId, force: true });
  await JobLog.create({ siteId, action:'run', status:'success', message:'Manual trigger enqueued' });
  res.json({ ok:true, message:'Manual trigger enqueued' });
}));

export default router;
