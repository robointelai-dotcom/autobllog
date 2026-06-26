import { URL } from 'url';
import { Types } from 'mongoose';

function badRequest(message){
  const err = new Error(message);
  err.status = 400;
  return err;
}

function boundedNumber(value, min, max, label){
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`${label} must be a valid number`);
  return Math.max(min, Math.min(max, n));
}

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
  if (!raw) throw badRequest('Site URL is required');
  let u;
  try { u = new URL(raw); } catch { throw badRequest('Invalid site URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw badRequest('Site URL must start with http:// or https://');
  if (u.username || u.password) throw badRequest('Site URL must not contain embedded username or password credentials');
  u.hash = '';
  u.search = '';
  // Dashboard should call the WP root, not a random path.
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '') || ''}`;
}

export function wpEndpoint(siteUrl, path){
  const base = normalizeSiteUrl(siteUrl).replace(/\/+$/, '') + '/';
  const cleanPath = String(path || '').trim();

  // v18.1 fix: many WordPress sites return an HTML 404 for /wp-json/*
  // when pretty permalinks, LiteSpeed/security rules, or Nginx rewrites are not
  // passing the REST route correctly. WordPress always supports the native
  // query-string REST format below, so the dashboard uses it by default.
  // Set WP_REST_STYLE=wp-json in .env only if you explicitly need /wp-json/*.
  const restStyle = String(process.env.WP_REST_STYLE || process.env.WP_REST_MODE || 'query').toLowerCase();
  if (restStyle !== 'wp-json' && /^\/?wp-json\//i.test(cleanPath.split('?')[0] || '')) {
    const pseudo = new URL((cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath), 'https://local.invalid');
    const route = '/' + pseudo.pathname.replace(/^\/wp-json\/+?/i, '').replace(/^\/+/, '');
    const u = new URL(base);
    u.searchParams.set('rest_route', route);
    for (const [key, value] of pseudo.searchParams.entries()) u.searchParams.append(key, value);
    return u.toString();
  }

  return new URL(cleanPath.replace(/^\/+/, ''), base).toString();
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

  const modes = ['manual','everySeconds','everyHours','randomHourly','dailyTime','cron','once'];
  if ('scheduleMode' in input) {
    const requestedMode = input.scheduleMode === 'randomHours' ? 'randomHourly' : input.scheduleMode;
    if (!modes.includes(requestedMode)) throw badRequest('Invalid schedule mode');
    out.scheduleMode = requestedMode;
  }
  if ('everySeconds' in input) out.everySeconds = input.everySeconds === null || input.everySeconds === '' ? null : boundedNumber(input.everySeconds, 1, 100000000, 'Every-seconds value');
  if ('everyHours' in input) out.everyHours = input.everyHours === null || input.everyHours === '' ? null : boundedNumber(input.everyHours, 1, 8760, 'Every-hours value');
  if ('randomHours' in input) out.randomHours = input.randomHours === null || input.randomHours === '' ? null : boundedNumber(input.randomHours, 1, 8760, 'Random-hours value');
  if ('randomMinuteMin' in input) out.randomMinuteMin = input.randomMinuteMin === null || input.randomMinuteMin === '' ? 0 : boundedNumber(input.randomMinuteMin, 0, 59, 'Random minimum minute');
  if ('randomMinuteMax' in input) out.randomMinuteMax = input.randomMinuteMax === null || input.randomMinuteMax === '' ? 59 : boundedNumber(input.randomMinuteMax, 0, 59, 'Random maximum minute');
  if (out.randomMinuteMin !== undefined && out.randomMinuteMax !== undefined && out.randomMinuteMax < out.randomMinuteMin) {
    const tmp = out.randomMinuteMin; out.randomMinuteMin = out.randomMinuteMax; out.randomMinuteMax = tmp;
  }
  if ('dailyAt' in input) {
    out.dailyAt = cleanString(input.dailyAt, 20) || null;
    if (out.dailyAt && !isValidTimeHHMM(out.dailyAt)) throw badRequest('Daily time must be HH:MM');
  }
  if ('timezone' in input) {
    out.timezone = cleanString(input.timezone, 80) || null;
    if (out.timezone && !isValidTimezone(out.timezone)) throw badRequest('Invalid timezone');
  }
  if ('scheduleCron' in input) out.scheduleCron = cleanString(input.scheduleCron, 120) || null;
  if ('onceAt' in input) {
    out.onceAt = input.onceAt ? new Date(input.onceAt) : null;
    if (out.onceAt && Number.isNaN(out.onceAt.getTime())) throw badRequest('Invalid once date');
  }
  if ('dailyLimit' in input) out.dailyLimit = boundedNumber(input.dailyLimit || 0, 0, 100000, 'Daily limit');
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
      Backlink: cleanString(pickAlias(it, ['Backlink','backlink','BacklinkURL','backlink_url','backlinkUrl','URL','url']), 2000),
      Prompt: cleanString(pickAlias(it, ['Prompt','prompt','CustomPrompt','custom_prompt','PostPrompt','post_prompt','AI Prompt','ai_prompt']), 20000)
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
