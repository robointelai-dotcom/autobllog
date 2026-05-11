import express from 'express';
import JobLog from '../models/JobLog.js';

const router = express.Router();

router.post('/trigger', async (req,res)=>{
  const { siteId } = req.body || {};
  if (!siteId) return res.status(400).json({ error:'siteId required' });
  await req.agenda.now('run-v5-bridge', { siteId, force: true });
  await JobLog.create({ siteId, action:'run', status:'success', message:'Manual trigger enqueued' });
  res.json({ ok:true });
});

export default router;
