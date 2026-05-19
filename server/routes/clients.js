import express from 'express';
import ClientApp from '../models/ClientApp.js';
import { asyncHandler, cleanString } from '../lib/utils.js';
import { clientUrlFromRequest, DEFAULT_TENANT, ensureDefaultClientRecord, getTenantModels, normalizeTenantSlug, tenantDbName } from '../lib/tenants.js';
import { initializeTenantAuth } from '../lib/auth.js';

const router = express.Router();

function row(req, item){
  return {
    _id: item._id,
    slug: item.slug,
    name: item.name,
    databaseName: item.databaseName,
    enabled: item.enabled,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastOpenedAt: item.lastOpenedAt,
    url: clientUrlFromRequest(req, item.slug)
  };
}

router.get('/', asyncHandler(async (req, res) => {
  await ensureDefaultClientRecord();
  const items = await ClientApp.find().sort({ slug: 1 }).lean();
  res.json(items.map(item => row(req, item)));
}));

router.post('/', asyncHandler(async (req, res) => {
  const slug = normalizeTenantSlug(req.body?.slug || req.body?.pageName);
  if (slug === DEFAULT_TENANT) return res.status(400).json({ error: 'Use a custom page name like global1. Root app already exists.' });
  const name = cleanString(req.body?.name, 120) || slug;
  const databaseName = tenantDbName(slug);
  const exists = await ClientApp.findOne({ slug }).lean();
  if (exists) return res.status(409).json({ error: `Client page already exists: /${slug}`, client: row(req, exists) });

  const created = await ClientApp.create({ slug, name, databaseName, enabled: true, createdBy: req.dashboardUser?.username || '' });

  // Touch the tenant database and auth store now, so the URL is immediately usable.
  const { Site, JobLog } = getTenantModels(slug);
  await Site.createCollection().catch(()=>{});
  await JobLog.createCollection().catch(()=>{});
  initializeTenantAuth(slug);

  res.status(201).json({ ok: true, message: `Client app created at /${slug}`, client: row(req, created) });
}));

router.put('/:slug', asyncHandler(async (req, res) => {
  const slug = normalizeTenantSlug(req.params.slug);
  if (slug === DEFAULT_TENANT) return res.status(400).json({ error: 'Root app cannot be modified here.' });
  const patch = {};
  if ('name' in req.body) patch.name = cleanString(req.body.name, 120) || slug;
  if ('enabled' in req.body) patch.enabled = !!req.body.enabled;
  const updated = await ClientApp.findOneAndUpdate({ slug }, { $set: patch }, { new: true }).lean();
  if (!updated) return res.status(404).json({ error: 'Client app not found' });
  res.json({ ok: true, client: row(req, updated) });
}));

export default router;
