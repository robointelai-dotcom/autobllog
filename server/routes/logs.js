import express from 'express';
import JobLog from '../models/JobLog.js';
import { asyncHandler, isObjectId } from '../lib/utils.js';
const router = express.Router();

router.get('/', asyncHandler(async (req,res)=>{
  const { siteId, status, action } = req.query;
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
  const q={};
  if (siteId) {
    if (!isObjectId(siteId)) return res.status(400).json({ error:'Invalid siteId' });
    q.siteId = siteId;
  }
  if (status) q.status = status;
  if (action) q.action = action;
  const items = await JobLog.find(q).sort({ createdAt: -1 }).limit(limit);
  res.json(items);
}));

export default router;
