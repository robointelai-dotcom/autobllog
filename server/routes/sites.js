import express from 'express';
import { ensureSiteSchedule } from '../lib/jobs.js';
import { fetchWithTimeout, readBridgeResponse } from '../lib/http.js';
import { asyncHandler, cleanString, isObjectId, maskSite, normalizeSiteUrl, pickSitePatch, wpEndpoint } from '../lib/utils.js';
import { buildSafePromptTemplate, generatePromptWithGemini, validateArticlePrompt } from '../lib/promptGenerator.js';

const router = express.Router();

function boundedNumber(value, fallback, minimum = 0, maximum = Infinity){
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(minimum, Math.min(maximum, fallback));
  return Math.max(minimum, Math.min(maximum, parsed));
}

function positiveTimeout(value, fallback, minimum = 1000){
  return boundedNumber(value, fallback, minimum);
}

async function callBridge(site, bridgePath, options = {}){
  const method = options.method || 'GET';
  const headers = { 'x-api-key': site.apiKey, ...(options.headers || {}) };
  let body;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }
  const u = wpEndpoint(site.url, bridgePath);
  const timeoutMs = positiveTimeout(options.timeoutMs ?? process.env.BRIDGE_TIMEOUT_MS, 30000);
  const r = await fetchWithTimeout(u, { method, headers, body }, timeoutMs);
  return readBridgeResponse(r);
}

async function loadSiteOr404(req, id){
  const { Site } = req.models;
  if (!isObjectId(id)) { const err = new Error('Invalid site id'); err.status = 400; throw err; }
  const site = await Site.findById(id);
  if (!site) { const err = new Error('Site not found'); err.status = 404; throw err; }
  return site;
}

router.get('/', asyncHandler(async (req,res)=>{
  const { Site } = req.models;
  const items = await Site.find().sort({ createdAt: -1 });
  res.json(items.map(maskSite));
}));

router.post('/', asyncHandler(async (req,res)=>{
  const { Site } = req.models;
  const body = req.body || {};
  const name = cleanString(body.name, 120);
  const apiKey = cleanString(body.apiKey, 500);
  if (!name || !body.url || !apiKey) return res.status(400).json({ error:'name, url, apiKey required' });
  const created = await Site.create({ name, url: normalizeSiteUrl(body.url), apiKey, scheduleMode:'manual' });
  await ensureSiteSchedule(req.agenda, created, req.isManualOnly, req.tenantSlug);
  res.status(201).json(maskSite(created));
}));

router.put('/:id', asyncHandler(async (req,res)=>{
  const { Site } = req.models;
  const id = req.params.id;
  if (!isObjectId(id)) return res.status(400).json({ error:'Invalid site id' });
  const patch = pickSitePatch(req.body || {});
  const updated = await Site.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
  if (!updated) return res.status(404).json({ error:'Site not found' });
  await ensureSiteSchedule(req.agenda, updated, req.isManualOnly, req.tenantSlug);
  res.json(maskSite(updated));
}));

router.get('/:id/wp-settings', asyncHandler(async (req,res)=>{
  const { JobLog } = req.models;
  const site = await loadSiteOr404(req, req.params.id);
  try {
    const data = await callBridge(site, '/wp-json/grb/v1/settings');
    await JobLog.create({ siteId: site._id, action:'settings', status:'success', message:'Loaded remote settings', payload: { geminiKeySet: data.geminiKeySet, bridgeKeySet: data.bridgeKeySet, pluginActive: data.pluginActive } }).catch(()=>{});
    res.json(data);
  } catch(e) {
    await JobLog.create({ siteId: site._id, action:'settings', status:'error', message:e.message, payload:e.payload }).catch(()=>{});
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error:e.message, payload:e.payload });
  }
}));

router.post('/:id/wp-settings', asyncHandler(async (req,res)=>{
  const { JobLog } = req.models;
  const site = await loadSiteOr404(req, req.params.id);
  const body = req.body || {};
  const payload = {};
  if ('bridgeApiKey' in body) {
    const v = cleanString(body.bridgeApiKey, 500);
    if (!v || v.length < 12) return res.status(400).json({ error:'Bridge API key must be at least 12 characters' });
    payload.bridgeApiKey = v;
  }
  if ('geminiApiKey' in body) { const v = cleanString(body.geminiApiKey, 3000); if (v) payload.geminiApiKey = v; }
  if ('clearGeminiApiKey' in body) payload.clearGeminiApiKey = !!body.clearGeminiApiKey;
  if ('geminiModel' in body) { const v = cleanString(body.geminiModel, 120); if (v) payload.geminiModel = v; }
  if ('customPrompt' in body) payload.customPrompt = cleanString(body.customPrompt, 20000);
  if ('clearCustomPrompt' in body) payload.clearCustomPrompt = !!body.clearCustomPrompt;
  if ('cronEnabled' in body) payload.cronEnabled = !!body.cronEnabled;
  if (Object.keys(payload).length === 0) return res.status(400).json({ error:'No setting changes supplied' });
  try {
    const data = await callBridge(site, '/wp-json/grb/v1/settings', { method:'POST', json: payload });
    if (payload.bridgeApiKey) { site.apiKey = payload.bridgeApiKey; await site.save(); }
    await JobLog.create({ siteId: site._id, action:'settings', status:'success', message:`Updated remote settings: ${(data.changed || []).join(', ') || 'saved'}`, payload: { changed: data.changed || [] } }).catch(()=>{});
    res.json({ ...data, site: maskSite(site) });
  } catch(e) {
    // A key-rotation response can be lost after WordPress has already saved the
    // new key. Verify the new key before reporting failure, then repair the
    // dashboard copy so the site is not permanently disconnected.
    if (payload.bridgeApiKey) {
      try {
        const candidate = { ...site.toObject(), apiKey: payload.bridgeApiKey };
        await callBridge(candidate, '/wp-json/grb/v1/ping');
        site.apiKey = payload.bridgeApiKey;
        await site.save();
        let recovered = {};
        try { recovered = await callBridge(candidate, '/wp-json/grb/v1/settings'); } catch {}
        await JobLog.create({ siteId: site._id, action:'settings', status:'success', message:'Recovered Bridge API key rotation after the original response was interrupted', payload:{ originalError:e.message } }).catch(()=>{});
        return res.json({ ...recovered, ok:true, recoveredApiKeyRotation:true, warning:'The original settings response failed, but the new Bridge key was verified and saved in the dashboard.', site:maskSite(site) });
      } catch {}
    }
    await JobLog.create({ siteId: site._id, action:'settings', status:'error', message:e.message, payload:e.payload }).catch(()=>{});
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error:e.message, payload:e.payload });
  }
}));

router.post('/:id/api-key', asyncHandler(async (req,res)=>{
  const { JobLog } = req.models;
  const site = await loadSiteOr404(req, req.params.id);
  const apiKey = cleanString(req.body?.apiKey, 500);
  const verify = req.body?.verify !== false;
  if (!apiKey || apiKey.length < 12) return res.status(400).json({ error:'API key must be at least 12 characters' });
  if (verify) {
    try { await callBridge({ ...site.toObject(), apiKey }, '/wp-json/grb/v1/ping'); }
    catch(e) { return res.status(e.status && e.status < 500 ? e.status : 400).json({ error:'New API key failed ping verification: '+e.message, payload:e.payload }); }
  }
  site.apiKey = apiKey;
  await site.save();
  await JobLog.create({ siteId: site._id, action:'settings', status:'success', message: verify ? 'Dashboard API key updated after successful ping' : 'Dashboard API key updated without verification' }).catch(()=>{});
  res.json(maskSite(site));
}));

router.post('/:id/gemini-test', asyncHandler(async (req,res)=>{
  const { JobLog } = req.models;
  const site = await loadSiteOr404(req, req.params.id);
  const body = req.body || {};
  const payload = {};
  if ('geminiApiKey' in body && cleanString(body.geminiApiKey, 3000)) payload.geminiApiKey = cleanString(body.geminiApiKey, 3000);
  if ('geminiModel' in body && cleanString(body.geminiModel, 120)) payload.geminiModel = cleanString(body.geminiModel, 120);
  try {
    const data = await callBridge(site, '/wp-json/grb/v1/settings/test-gemini', { method:'POST', json: payload, timeoutMs: positiveTimeout(process.env.BRIDGE_AI_TIMEOUT_MS, 90000, 45000) });
    await JobLog.create({ siteId: site._id, action:'gemini-test', status:'success', message: data.message || 'Gemini key test passed', payload: { model: data.model, usedSavedKey: data.usedSavedKey } }).catch(()=>{});
    res.json(data);
  } catch(e) {
    await JobLog.create({ siteId: site._id, action:'gemini-test', status:'error', message:e.message, payload:e.payload }).catch(()=>{});
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error:e.message, payload:e.payload });
  }
}));

router.get('/:id/prompt', asyncHandler(async (req,res)=>{
  const { JobLog } = req.models;
  const site = await loadSiteOr404(req, req.params.id);
  try {
    const data = await callBridge(site, '/wp-json/grb/v1/prompt');
    await JobLog.create({ siteId: site._id, action:'prompt', status:'success', message:'Loaded prompt studio settings', payload:{ customPromptSet:data.customPromptSet, customPromptLength:data.customPromptLength } }).catch(()=>{});
    res.json(data);
  } catch(e) {
    try {
      const settings = await callBridge(site, '/wp-json/grb/v1/settings');
      res.json({ ok:true, fallback:true, customPrompt:'', defaultPrompt:'', variables:['$topic','$keyword','$backlink'], ...settings });
    } catch(e2) {
      await JobLog.create({ siteId: site._id, action:'prompt', status:'error', message:e2.message, payload:e2.payload }).catch(()=>{});
      res.status(e2.status && e2.status < 500 ? e2.status : 502).json({ error:e2.message, payload:e2.payload });
    }
  }
}));

router.post('/:id/prompt', asyncHandler(async (req,res)=>{
  const { JobLog } = req.models;
  const site = await loadSiteOr404(req, req.params.id);
  const body = req.body || {};
  const payload = {};
  if ('clearCustomPrompt' in body) payload.clearCustomPrompt = !!body.clearCustomPrompt;
  if ('customPrompt' in body) payload.customPrompt = cleanString(body.customPrompt, 20000);
  if ('previewTopic' in body) payload.previewTopic = cleanString(body.previewTopic, 240);
  if ('previewKeyword' in body) payload.previewKeyword = cleanString(body.previewKeyword, 240);
  if (Object.keys(payload).length === 0) return res.status(400).json({ error:'No prompt changes supplied' });
  try {
    let data;
    try { data = await callBridge(site, '/wp-json/grb/v1/prompt', { method:'POST', json: payload }); }
    catch (e) {
      if ('customPrompt' in payload || payload.clearCustomPrompt) data = await callBridge(site, '/wp-json/grb/v1/settings', { method:'POST', json: payload });
      else throw e;
    }
    await JobLog.create({ siteId: site._id, action:'prompt', status:'success', message: payload.clearCustomPrompt ? 'Custom prompt reset to default' : 'Custom prompt saved from dashboard', payload:{ customPromptLength:data.customPromptLength, warnings:data.warnings || [] } }).catch(()=>{});
    res.json(data);
  } catch(e) {
    await JobLog.create({ siteId: site._id, action:'prompt', status:'error', message:e.message, payload:e.payload }).catch(()=>{});
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error:e.message, payload:e.payload });
  }
}));


router.post('/:id/prompt/generate', asyncHandler(async (req,res)=>{
  const { JobLog } = req.models;
  const site = await loadSiteOr404(req, req.params.id);
  const body = req.body || {};
  const payload = {
    focus: cleanString(body.focus || 'SEO blog article', 160),
    businessType: cleanString(body.businessType || site.name || 'the selected WordPress site', 160),
    audience: cleanString(body.audience || 'readers and potential customers', 240),
    language: cleanString(body.language || 'English', 80),
    tone: cleanString(body.tone || 'professional, helpful, trustworthy and easy to understand', 180),
    wordCount: boundedNumber(body.wordCount, 1500, 700, 5000),
    compliance: cleanString(body.compliance || 'general', 40),
    extraRules: cleanString(body.extraRules || '', 2000),
    includeFaq: body.includeFaq !== false,
    includeTable: body.includeTable === true,
    includeConclusion: body.includeConclusion !== false,
    includeBacklink: body.includeBacklink !== false,
    geminiApiKey: cleanString(body.geminiApiKey || '', 3000),
    geminiModel: cleanString(body.geminiModel || 'gemini-2.5-flash', 120)
  };

  // Best path: updated WordPress Bridge can use the Gemini key already saved on that site.
  try {
    const data = await callBridge(site, '/wp-json/grb/v1/prompt/generate', { method:'POST', json: payload, timeoutMs: positiveTimeout(process.env.BRIDGE_AI_TIMEOUT_MS, 90000, 90000) });
    await JobLog.create({ siteId: site._id, action:'prompt-ai-generate', status:'success', message:'AI prompt generated using WordPress Bridge/Gemini key', payload:{ warnings:data.warnings || [], source:data.source, model:data.model } }).catch(()=>{});
    return res.json(data);
  } catch (bridgeErr) {
    // Fallback: if the user pasted a temporary key in dashboard, generate from dashboard.
    if (payload.geminiApiKey) {
      try {
        const data = await generatePromptWithGemini(payload);
        await JobLog.create({ siteId: site._id, action:'prompt-ai-generate', status:'success', message:'AI prompt generated using temporary dashboard Gemini key', payload:{ warnings:data.warnings || [], source:data.source, model:data.model } }).catch(()=>{});
        return res.json(data);
      } catch (aiErr) {
        await JobLog.create({ siteId: site._id, action:'prompt-ai-generate', status:'error', message:aiErr.message, payload:aiErr.payload || { bridgeError: bridgeErr.message } }).catch(()=>{});
        return res.status(aiErr.status && aiErr.status < 500 ? aiErr.status : 502).json({ error:aiErr.message, bridgeError: bridgeErr.message, payload: aiErr.payload });
      }
    }

    // Safe local template fallback so the user can still save a good prompt without AI.
    const prompt = buildSafePromptTemplate(payload);
    const warnings = validateArticlePrompt(prompt);
    await JobLog.create({ siteId: site._id, action:'prompt-ai-generate', status:'skipped', message:'Bridge AI generator unavailable; returned safe local template', payload:{ bridgeError: bridgeErr.message, warnings } }).catch(()=>{});
    return res.json({ ok:true, prompt, warnings, source:'dashboard-safe-template-fallback', bridgeError: bridgeErr.message, note:'Update the Bridge plugin to v2.8+ or paste a temporary Gemini key to generate with AI.' });
  }
}));

router.post('/:id/prompt/activate-ai', asyncHandler(async (req,res)=>{
  const { JobLog } = req.models;
  const site = await loadSiteOr404(req, req.params.id);
  const body = req.body || {};
  const customPrompt = cleanString(body.customPrompt || body.prompt || '', 20000);
  if (!customPrompt) return res.status(400).json({ error:'customPrompt is required' });
  const warnings = validateArticlePrompt(customPrompt);
  const settingsPayload = {
    customPrompt,
    cronEnabled: body.cronEnabled === true
  };
  const geminiApiKey = cleanString(body.geminiApiKey || '', 3000);
  const geminiModel = cleanString(body.geminiModel || '', 120);
  if (geminiApiKey) settingsPayload.geminiApiKey = geminiApiKey;
  if (geminiModel) settingsPayload.geminiModel = geminiModel;
  try {
    const data = await callBridge(site, '/wp-json/grb/v1/settings', { method:'POST', json: settingsPayload });
    await JobLog.create({ siteId: site._id, action:'prompt-ai-activate', status:'success', message:'Prompt saved and AI auto-generation settings activated', payload:{ changed:data.changed || [], warnings } }).catch(()=>{});
    res.json({ ...data, warnings, promptSaved:true, autoGenerateEnabled: !!settingsPayload.cronEnabled });
  } catch(e) {
    await JobLog.create({ siteId: site._id, action:'prompt-ai-activate', status:'error', message:e.message, payload:e.payload }).catch(()=>{});
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error:e.message, payload:e.payload });
  }
}));

router.get('/:id/plugins', asyncHandler(async (req,res)=>{
  const { JobLog } = req.models;
  const site = await loadSiteOr404(req, req.params.id);
  try {
    const data = await callBridge(site, '/wp-json/grb/v1/plugins');
    await JobLog.create({ siteId: site._id, action:'plugins', status:'success', message:`Loaded ${data.count ?? 0} remote plugins`, payload:{ activeCount:data.activeCount, inactiveCount:data.inactiveCount, updateCount:data.updateCount } }).catch(()=>{});
    res.json(data);
  } catch(e) {
    await JobLog.create({ siteId: site._id, action:'plugins', status:'error', message:e.message, payload:e.payload }).catch(()=>{});
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error:e.message, payload:e.payload });
  }
}));

router.post('/:id/plugins/action', asyncHandler(async (req,res)=>{
  const { JobLog } = req.models;
  const site = await loadSiteOr404(req, req.params.id);
  const body = req.body || {};
  const action = cleanString(body.action, 40).toLowerCase();
  const plugin = cleanString(body.plugin, 500);
  const allowed = ['activate','deactivate','reactivate','delete'];
  if (!allowed.includes(action)) return res.status(400).json({ error:'Invalid plugin action' });
  if (!plugin) return res.status(400).json({ error:'Plugin file is required' });
  const payload = { action, plugin, forceDeactivate: !!body.forceDeactivate };
  try {
    const data = await callBridge(site, '/wp-json/grb/v1/plugins/action', { method:'POST', json: payload });
    await JobLog.create({ siteId: site._id, action:'plugin-'+action, status:'success', message:`${action} completed for ${plugin}`, payload:{ plugin, activeCount:data.activeCount, inactiveCount:data.inactiveCount } }).catch(()=>{});
    res.json(data);
  } catch(e) {
    await JobLog.create({ siteId: site._id, action:'plugin-'+action, status:'error', message:e.message, payload:e.payload || { plugin } }).catch(()=>{});
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error:e.message, payload:e.payload });
  }
}));

router.post('/:id/plugins/upload', asyncHandler(async (req,res)=>{
  const { JobLog } = req.models;
  const site = await loadSiteOr404(req, req.params.id);
  const body = req.body || {};
  const filename = cleanString(body.filename, 240);
  const contentBase64 = typeof body.contentBase64 === 'string' ? body.contentBase64 : '';
  if (!filename || !filename.toLowerCase().endsWith('.zip')) return res.status(400).json({ error:'Only .zip plugin upload is allowed' });
  if (!contentBase64) return res.status(400).json({ error:'contentBase64 is required' });
  if (contentBase64.length > boundedNumber(process.env.PLUGIN_UPLOAD_BASE64_LIMIT, 90 * 1024 * 1024, 1024 * 1024, 128 * 1024 * 1024)) return res.status(413).json({ error:'Plugin ZIP is too large for dashboard upload' });
  const payload = { filename, contentBase64, activate: !!body.activate };
  try {
    const data = await callBridge(site, '/wp-json/grb/v1/plugins/upload', { method:'POST', json: payload, timeoutMs: positiveTimeout(process.env.BRIDGE_UPLOAD_TIMEOUT_MS, 180000, 120000) });
    await JobLog.create({ siteId: site._id, action:'plugin-upload', status:'success', message:`Uploaded plugin ${filename}${data.activated ? ' and activated it' : ''}`, payload:{ filename, installedPlugin:data.installedPlugin, activated:data.activated } }).catch(()=>{});
    res.json(data);
  } catch(e) {
    await JobLog.create({ siteId: site._id, action:'plugin-upload', status:'error', message:e.message, payload:e.payload || { filename } }).catch(()=>{});
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error:e.message, payload:e.payload });
  }
}));

router.delete('/:id', asyncHandler(async (req,res)=>{
  const { Site } = req.models;
  const id = req.params.id;
  if (!isObjectId(id)) return res.status(400).json({ error:'Invalid site id' });
  await req.agenda.cancel({ name:'run-v5-bridge', 'data.siteId': id, 'data.tenantSlug': req.tenantSlug });
  await req.agenda.cancel({ name:'run-v5-bridge-random-hourly', 'data.siteId': id, 'data.tenantSlug': req.tenantSlug });
  const deleted = await Site.deleteOne({ _id: id });
  res.json({ ok:true, deleted: deleted.deletedCount });
}));

router.post('/:id/ping', asyncHandler(async (req,res)=>{
  const { Site, JobLog } = req.models;
  const id = req.params.id;
  if (!isObjectId(id)) return res.status(400).json({ error:'Invalid site id' });
  const site = await Site.findById(id);
  if (!site) return res.status(404).json({ error:'Not found' });
  try{
    const u = wpEndpoint(site.url, '/wp-json/grb/v1/ping');
    const r = await fetchWithTimeout(u, { headers: { 'x-api-key': site.apiKey } }, positiveTimeout(process.env.BRIDGE_TIMEOUT_MS, 15000));
    const data = await readBridgeResponse(r);
    await JobLog.create({ siteId: site._id, action:'ping', status:'success', message: typeof data === 'string' ? data : JSON.stringify(data), payload: typeof data === 'object' ? data : undefined });
    res.json(data);
  }catch(e){
    await JobLog.create({ siteId: site._id, action:'ping', status:'error', message: e.message, payload: e.payload });
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message, payload: e.payload });
  }
}));

export default router;
