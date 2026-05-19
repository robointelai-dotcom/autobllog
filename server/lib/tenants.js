import mongoose from 'mongoose';
import { SiteSchema } from '../models/Site.js';
import { JobLogSchema } from '../models/JobLog.js';
import ClientApp from '../models/ClientApp.js';

export const DEFAULT_TENANT = 'main';
const RESERVED_SLUGS = new Set([
  'api','assets','asset','static','client','clients','admin','login','logout','healthz','favicon.ico',
  'wp-admin','wp-json','server','dist','build','node_modules','release-plugins'
]);

function dbSafe(value){
  return String(value || '').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80);
}

function baseDbName(){
  const explicit = process.env.MULTI_CLIENT_DB_PREFIX || process.env.TENANT_DB_PREFIX || '';
  if (explicit) return dbSafe(explicit.replace(/_+$/,''));
  const name = mongoose.connection?.name || 'remotecontroller';
  return dbSafe(name || 'remotecontroller');
}

export function normalizeTenantSlug(value){
  const slug = String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!slug) return DEFAULT_TENANT;
  if (!/^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$|^[a-z0-9]$/.test(slug)) {
    const err = new Error('Client page name must use lowercase letters, numbers, and hyphen only. Example: global1');
    err.status = 400;
    throw err;
  }
  if (RESERVED_SLUGS.has(slug)) {
    const err = new Error(`"${slug}" is reserved. Use another page name.`);
    err.status = 400;
    throw err;
  }
  return slug;
}

export function tenantDbName(slug){
  const safe = normalizeTenantSlug(slug);
  if (safe === DEFAULT_TENANT) return mongoose.connection?.name || 'remotecontroller';
  return `${baseDbName()}_client_${safe.replace(/-/g, '_')}`;
}

const modelCache = new Map();

export function getTenantModels(slug = DEFAULT_TENANT){
  const safe = normalizeTenantSlug(slug);
  if (modelCache.has(safe)) return modelCache.get(safe);
  const conn = safe === DEFAULT_TENANT ? mongoose.connection : mongoose.connection.useDb(tenantDbName(safe), { useCache: true });
  const Site = conn.models.Site || conn.model('Site', SiteSchema);
  const JobLog = conn.models.JobLog || conn.model('JobLog', JobLogSchema);
  const models = { slug: safe, databaseName: tenantDbName(safe), connection: conn, Site, JobLog };
  modelCache.set(safe, models);
  return models;
}

export async function ensureDefaultClientRecord(){
  await ClientApp.updateOne(
    { slug: DEFAULT_TENANT },
    { $setOnInsert: { slug: DEFAULT_TENANT, name: 'Main Dashboard', databaseName: tenantDbName(DEFAULT_TENANT), enabled: true } },
    { upsert: true }
  ).catch(()=>{});
}

export function tenantMiddleware(slugGetter){
  return async (req, res, next) => {
    try {
      const slug = normalizeTenantSlug(typeof slugGetter === 'function' ? slugGetter(req) : slugGetter);
      req.tenantSlug = slug;
      req.tenantDatabaseName = tenantDbName(slug);
      req.models = getTenantModels(slug);
      if (slug !== DEFAULT_TENANT) {
        const tenant = await ClientApp.findOne({ slug, enabled: true }).lean();
        if (!tenant) return res.status(404).json({ error: `Client app not found or disabled: ${slug}` });
        req.clientApp = tenant;
        ClientApp.updateOne({ slug }, { $set: { lastOpenedAt: new Date() } }).catch(()=>{});
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export function clientUrlFromRequest(req, slug){
  const safe = normalizeTenantSlug(slug);
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host') || '';
  return `${proto}://${host}${safe === DEFAULT_TENANT ? '/' : `/${safe}/`}`;
}
