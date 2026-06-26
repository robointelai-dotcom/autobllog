import fetch from 'node-fetch';
import AbortController from 'abort-controller';

const SENSITIVE_FIELD = /^(?:key|api[_-]?key|apikey|gemini[_-]?api[_-]?key|bridge[_-]?api[_-]?key|token|access[_-]?token|secret|password|authorization)$/i;

export function redactSecrets(value, depth = 0){
  if (depth > 8 || value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value
      .replace(/((?:[?&]|\b)(?:key|api_key|apikey|geminiApiKey|bridgeApiKey|token|access_token|secret|password)=)[^&\s,;]*/gi, '$1[REDACTED]')
      .replace(/(["'](?:key|api[_-]?key|apikey|geminiApiKey|bridgeApiKey|token|access[_-]?token|secret|password)["']\s*:\s*["'])[^"']*(["'])/gi, '$1[REDACTED]$2')
      .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(item => redactSecrets(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_FIELD.test(key) ? '[REDACTED]' : redactSecrets(item, depth + 1);
    }
    return out;
  }
  return value;
}

export function safeUrlForError(value){
  try {
    const u = new URL(String(value));
    const sensitive = new Set(['key','api_key','apikey','token','access_token','secret','password']);
    for (const name of [...u.searchParams.keys()]) {
      if (sensitive.has(String(name).toLowerCase())) u.searchParams.set(name, '[REDACTED]');
    }
    return u.toString();
  } catch {
    return String(value || '').replace(/([?&](?:key|api_key|apikey|token|access_token|secret|password)=)[^&\s]*/gi, '$1[REDACTED]');
  }
}

export async function fetchWithTimeout(url, opts={}, ms){
  const parsedTimeout = Number(ms ?? opts.timeout ?? process.env.BRIDGE_TIMEOUT_MS ?? 45000);
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? Math.max(1000, parsedTimeout) : 45000;
  const { timeout, ...rest } = opts;
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), Math.max(1000, timeoutMs));
  try {
    return await fetch(url, { ...rest, signal: ac.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutError = new Error(`Request timed out after ${timeoutMs}ms: ${safeUrlForError(url)}`);
      timeoutError.status = 504;
      timeoutError.code = 'ETIMEDOUT';
      throw timeoutError;
    }
    const unsafeUrl = String(url || '');
    const safeUrl = safeUrlForError(unsafeUrl);
    if (err && typeof err.message === 'string') {
      const replaced = unsafeUrl && safeUrl !== unsafeUrl ? err.message.split(unsafeUrl).join(safeUrl) : err.message;
      const cleanMessage = redactSecrets(replaced);
      if (cleanMessage !== err.message || safeUrl !== unsafeUrl) {
        const clean = new Error(cleanMessage);
        clean.name = err.name || 'Error';
        clean.code = err.code;
        clean.status = err.status;
        clean.cause = err;
        throw clean;
      }
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

export async function readBridgeResponse(response){
  const text = await response.text();
  const contentType = response.headers?.get?.('content-type') || '';
  let data = text;
  try { data = text ? JSON.parse(text) : {}; } catch {}

  const looksHtml = typeof text === 'string' && /<!doctype html|<html[\s>]|<body[\s>]|<title[\s>]|wp-login\.php/i.test(text);
  const looksJson = typeof data === 'object' && data !== null;

  if (!response.ok || (!looksJson && looksHtml)) {
    const safeData = looksJson ? redactSecrets(data) : data;
    let msg = looksJson ? (safeData?.message || safeData?.error || JSON.stringify(safeData)) : redactSecrets(text);

    if (response.status === 401) {
      msg = 'Unauthorized. Bridge API key in dashboard does not match the key saved in WordPress AutoBlog Bridge.';
    } else if (response.status === 403) {
      msg = 'Forbidden. A security plugin, firewall, Cloudflare rule, or server config blocked the Bridge REST request.';
    } else if (looksHtml) {
      msg = 'WordPress returned an HTML page instead of Bridge JSON. This usually means the Bridge plugin is not active on this exact Site URL, the Site URL is wrong, or REST API/rewrite rules are blocked. v18.3 uses WordPress ?rest_route= mode to avoid common /wp-json 404 rewrite problems.';
    }

    if (typeof msg === 'string' && msg.length > 900) msg = msg.slice(0,900) + '...';
    const err = new Error(`Bridge HTTP ${response.status}: ${msg || response.statusText}`);
    err.status = response.status;
    err.payload = looksJson ? safeData : { contentType, preview: typeof text === 'string' ? redactSecrets(text.slice(0, 400)) : '' };
    throw err;
  }

  if (!looksJson) {
    const err = new Error(`Bridge returned non-JSON response (${contentType || 'unknown content-type'}). Check WordPress Bridge plugin and REST API.`);
    err.status = response.status || 502;
    err.payload = { contentType, preview: typeof text === 'string' ? redactSecrets(text.slice(0, 400)) : '' };
    throw err;
  }

  return data;
}
