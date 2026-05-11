import express from 'express';
import fetch from 'node-fetch';
import Site from '../models/Site.js';

const router = express.Router();

router.get('/', async (req,res)=>{
  const { siteId } = req.query;
  const site = await Site.findById(siteId);
  if (!site) return res.status(404).json({ error:'site not found' });
  const u = new URL('wp-json/grb/v1/queue', site.url).toString();
  const r = await fetch(u, { headers:{ 'x-api-key': site.apiKey } });
  const t = await r.text();
  try{ res.status(r.ok?200:500).json(JSON.parse(t)) }catch{ res.status(r.ok?200:500).send(t) }
});

router.post('/append', async (req,res)=>{
  const { siteId, items } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ error:'items must be an array' });
  if (items.length === 0) return res.status(400).json({ error:'no rows' });
  if (items.length > 5000) return res.status(413).json({ error:'too many rows (max 5000)' });
  for (let i=0;i<items.length;i++){
    const it = items[i] || {};
    if (!it.Keyword || typeof it.Keyword !== 'string') return res.status(400).json({ error:`row ${i+1}: Keyword is required` });
  }
  const site = await Site.findById(siteId);
  if (!site) return res.status(404).json({ error:'site not found' });
  const u = new URL('wp-json/grb/v1/queue/append', site.url).toString();
  const r = await fetch(u, {
    method:'POST', headers:{ 'Content-Type':'application/json', 'x-api-key': site.apiKey },
    body: JSON.stringify({ items })
  });
  const t = await r.text();
  try{ res.status(r.ok?200:500).json(JSON.parse(t)) }catch{ res.status(r.ok?200:500).send(t) }
});

router.post('/clear', async (req,res)=>{
  const { siteId, all } = req.body || {};
  const site = await Site.findById(siteId);
  if (!site) return res.status(404).json({ error:'site not found' });
  const u = new URL('wp-json/grb/v1/queue/clear', site.url).toString();
  const r = await fetch(u, {
    method:'POST', headers:{ 'Content-Type':'application/json', 'x-api-key': site.apiKey },
    body: JSON.stringify({ all: !!all })
  });
  const t = await r.text();
  try{ res.status(r.ok?200:500).json(JSON.parse(t)) }catch{ res.status(r.ok?200:500).send(t) }
});

export default router;
