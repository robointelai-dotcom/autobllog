import fetch from 'node-fetch';
import AbortController from 'abort-controller';

export async function fetchWithTimeout(url, opts={}, ms){
  const timeoutMs = Number(ms || opts.timeout || process.env.BRIDGE_TIMEOUT_MS || 45000);
  const { timeout, ...rest } = opts;
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), Math.max(1000, timeoutMs));
  try {
    return await fetch(url, { ...rest, signal: ac.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function readBridgeResponse(response){
  const text = await response.text();
  let data = text;
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) {
    const msg = typeof data === 'object' && data?.message ? data.message : text;
    const err = new Error(`Bridge HTTP ${response.status}: ${msg || response.statusText}`);
    err.status = response.status;
    err.payload = data;
    throw err;
  }
  return data;
}
