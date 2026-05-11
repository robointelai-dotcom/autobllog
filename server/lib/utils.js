import { URL } from 'url';
import { Types } from 'mongoose';

export function isObjectId(id){
  return typeof id === 'string' && Types.ObjectId.isValid(id);
}

export function asyncHandler(fn){
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function cleanString(value, max=500){
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/^\uFEFF/, '')
    .replace(/\u0000/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .normalize('NFKC')
    .trim()
    .slice(0, max);
}

function pickAlias(obj, names){
  if (!obj || typeof obj !== 'object') return '';
  const direct = names.find(n => Object.prototype.hasOwnProperty.call(obj, n));
  if (direct) return obj[direct];
  const map = new Map(Object.keys(obj).map(k => [String(k).replace(/^\uFEFF/, '').replace(/[\s_\-]+/g,'').toLowerCase(), k]));
  for (const n of names){
    const key = String(n).replace(/[\s_\-]+/g,'').toLowerCase();
    if (map.has(key)) return obj[map.get(key)];
  }
  return '';
}

export function normalizeSiteUrl(value){
  const raw = cleanString(value, 2000);
  if (!raw) throw new Error('Site URL is required');
  let u;
  try { u = new URL(raw); } catch { throw new Error('Invalid site URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Site URL must start with http:// or https://');
  u.hash = '';
  u.search = '';
  // Dashboard should call the WP root, not a random path.
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '') || ''}`;
}

export function wpEndpoint(siteUrl, path){
  const base = normalizeSiteUrl(siteUrl).replace(/\/+$/, '') + '/';
  return new URL(path.replace(/^\/+/, ''), base).toString();
}

export function isValidTimeHHMM(v){
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

export function isValidTimezone(tz){
  if (!tz) return true;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch { return false; }
}

export function parseBoolean(v, fallback=false){
  if (v === undefined || v === null || v === '') return fallback;
  return ['1','true','yes','on'].includes(String(v).toLowerCase());
}

export function maskSite(siteDoc){
  const obj = typeof siteDoc.toObject === 'function' ? siteDoc.toObject() : { ...siteDoc };
  if (obj.apiKey) obj.apiKeySet = true;
  delete obj.apiKey;
  return obj;
}

export function pickSitePatch(input){
  const out = {};
  if ('name' in input) out.name = cleanString(input.name, 120);
  if ('url' in input) out.url = normalizeSiteUrl(input.url);
  if ('apiKey' in input && cleanString(input.apiKey, 500)) out.apiKey = cleanString(input.apiKey, 500);
  if ('enabled' in input) out.enabled = !!input.enabled;

  const modes = ['manual','everySeconds','everyHours','dailyTime','cron','once'];
  if ('scheduleMode' in input) {
    if (!modes.includes(input.scheduleMode)) throw new Error('Invalid schedule mode');
    out.scheduleMode = input.scheduleMode;
  }
  if ('everySeconds' in input) out.everySeconds = input.everySeconds === null || input.everySeconds === '' ? null : Math.max(1, Math.min(100000000, Number(input.everySeconds)));
  if ('everyHours' in input) out.everyHours = input.everyHours === null || input.everyHours === '' ? null : Math.max(1, Math.min(8760, Number(input.everyHours)));
  if ('dailyAt' in input) {
    out.dailyAt = cleanString(input.dailyAt, 20) || null;
    if (out.dailyAt && !isValidTimeHHMM(out.dailyAt)) throw new Error('Daily time must be HH:MM');
  }
  if ('timezone' in input) {
    out.timezone = cleanString(input.timezone, 80) || null;
    if (out.timezone && !isValidTimezone(out.timezone)) throw new Error('Invalid timezone');
  }
  if ('scheduleCron' in input) out.scheduleCron = cleanString(input.scheduleCron, 120) || null;
  if ('onceAt' in input) {
    out.onceAt = input.onceAt ? new Date(input.onceAt) : null;
    if (out.onceAt && Number.isNaN(out.onceAt.getTime())) throw new Error('Invalid once date');
  }
  if ('dailyLimit' in input) out.dailyLimit = Math.max(0, Math.min(100000, Number(input.dailyLimit || 0)));
  return out;
}

export function validateQueueItems(items){
  if (!Array.isArray(items)) throw new Error('items must be an array');
  if (items.length === 0) throw new Error('no rows');
  if (items.length > 5000) { const err = new Error('too many rows (max 5000)'); err.status = 413; throw err; }
  const seen = new Set();
  return items.map((it, idx) => {
    const row = {
      Keyword: cleanString(pickAlias(it, ['Keyword','keyword','Keywords','keywords','Title','title']), 240),
      Topic: cleanString(pickAlias(it, ['Topic','topic','Subject','subject']), 240),
      Category: cleanString(pickAlias(it, ['Category','category','Categories','categories']), 120),
      Tags: cleanString(pickAlias(it, ['Tags','tags','Tag','tag']), 500),
      image: cleanString(pickAlias(it, ['image','Image','image_url','ImageURL','imageUrl','featured_image','Featured Image']), 2000),
      Backlink: cleanString(pickAlias(it, ['Backlink','backlink','BacklinkURL','backlink_url','backlinkUrl','URL','url']), 2000)
    };
    if (!row.Keyword) { const err = new Error(`row ${idx+1}: Keyword is required`); err.status = 400; throw err; }
    if (!row.Topic) row.Topic = row.Keyword;
    if (!row.Category) row.Category = 'Uncategorized';
    const key = row.Keyword.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) row._duplicateInUpload = true;
    seen.add(key);
    return row;
  });
}
