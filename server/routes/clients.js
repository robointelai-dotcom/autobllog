import express from 'express';
import ClientApp from '../models/ClientApp.js';
import { asyncHandler, cleanString } from '../lib/utils.js';
import { DEFAULT_TENANT, ensureDefaultClientRecord, normalizeTenantSlug } from '../lib/tenants.js';
import { initializeTenantAuth } from '../lib/auth.js';
import { checkInstanceHealth, clientPublicUrl, instanceDbName, instanceDir, pickClientPort, startClientInstance } from '../lib/instances.js';

const router = express.Router();

async function row(req, item){
  const health = item.port ? await checkInstanceHealth(item.port) : null;
  return {
    _id: item._id,
    slug: item.slug,
    name: item.name,
    databaseName: item.databaseName,
    enabled: item.enabled,
    mode: item.mode || 'instance',
    port: item.port || null,
    processPid: item.processPid || null,
    processStatus: health?.ok ? 'running' : (item.processStatus || 'created'),
    lastStartedAt: item.lastStartedAt,
    lastError: item.lastError || '',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastOpenedAt: item.lastOpenedAt,
    url: item.slug === DEFAULT_TENANT ? clientPublicUrl(req, '').replace('/main/','/') : clientPublicUrl(req, item.slug),
    instancePath: item.slug === DEFAULT_TENANT ? '' : instanceDir(item.slug)
  };
}

router.get('/', asyncHandler(async (req, res) => {
  await ensureDefaultClientRecord();
  const items = await ClientApp.find().sort({ slug: 1 }).lean();
  const out = [];
  for (const item of items) out.push(await row(req, item));
  res.json(out);
}));

router.post('/', asyncHandler(async (req, res) => {
  const slug = normalizeTenantSlug(req.body?.slug || req.body?.pageName);
  if (slug === DEFAULT_TENANT) return res.status(400).json({ error: 'Use a custom page name like global1. Root app already exists.' });
  const name = cleanString(req.body?.name, 120) || slug;
  const databaseName = instanceDbName(slug);
  const exists = await ClientApp.findOne({ slug }).lean();
  let created;
  if (exists) {
    // Upgrade older v12 tenant-style clients into v13 fresh backend instances.
    if (exists.mode === 'instance' && exists.port) {
      return res.status(409).json({ error: `Client page already exists: /${slug}`, client: await row(req, exists) });
    }
    const port = await pickClientPort();
    created = await ClientApp.findOneAndUpdate(
      { slug },
      { $set: { name, databaseName, enabled:true, mode:'instance', port, processStatus:'created', lastError:'' } },
      { new:true }
    );
  } else {
    const port = await pickClientPort();
    created = await ClientApp.create({
      slug,
      name,
      databaseName,
      enabled: true,
      mode: 'instance',
      port,
      processStatus: 'created',
      createdBy: req.dashboardUser?.username || ''
    });
  }

  // Create a fresh auth store for this client, then start its dedicated backend process.
  initializeTenantAuth(slug);
  const started = await startClientInstance(created.toObject ? created.toObject() : created);
  created = await ClientApp.findOne({ slug }).lean();

  const client = await row(req, created);
  res.status(started.ok ? 201 : 202).json({
    ok: !!started.ok,
    message: started.ok ? `Fresh client instance created at /${slug}` : `Client saved, but the instance did not become healthy yet. Check logs.`,
    client,
    started
  });
}));

router.post('/:slug/restart', asyncHandler(async (req, res) => {
  const slug = normalizeTenantSlug(req.params.slug);
  if (slug === DEFAULT_TENANT) return res.status(400).json({ error: 'Root app cannot be restarted from here.' });
  const client = await ClientApp.findOne({ slug, enabled:true }).lean();
  if (!client) return res.status(404).json({ error: 'Client app not found' });
  const started = await startClientInstance(client);
  const updated = await ClientApp.findOne({ slug }).lean();
  res.json({ ok: !!started.ok, client: await row(req, updated), started });
}));

router.put('/:slug', asyncHandler(async (req, res) => {
  const slug = normalizeTenantSlug(req.params.slug);
  if (slug === DEFAULT_TENANT) return res.status(400).json({ error: 'Root app cannot be modified here.' });
  const patch = {};
  if ('name' in req.body) patch.name = cleanString(req.body.name, 120) || slug;
  if ('enabled' in req.body) patch.enabled = !!req.body.enabled;
  const updated = await ClientApp.findOneAndUpdate({ slug }, { $set: patch }, { new: true }).lean();
  if (!updated) return res.status(404).json({ error: 'Client app not found' });
  res.json({ ok: true, client: await row(req, updated) });
}));

export default router;
