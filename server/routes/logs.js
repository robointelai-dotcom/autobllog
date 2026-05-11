import express from 'express';
import JobLog from '../models/JobLog.js';
const router = express.Router();

router.get('/', async (req,res)=>{
  const { siteId, status, action, limit=200 } = req.query;
  const q={};
  if (siteId) q.siteId = siteId;
  if (status) q.status = status;
  if (action) q.action = action;
  const items = await JobLog.find(q).sort({ createdAt: -1 }).limit(Number(limit));
  res.json(items);
});

export default router;
