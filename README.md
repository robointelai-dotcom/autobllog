# AutoBlog 6.1 (Fixed)

A hardened scheduler + API that posts to WordPress sites via a plugin endpoint (`wp-json/ab/v1/*`).

## Highlights
- Agenda heartbeat enabled (`SCAN_EVERY`, default 1 minute)
- Per-site timezone-aware scheduling (daily/cron/every)
- Unique per-site scheduled job; no duplicates
- Concurrency via `PUSH_CONCURRENCY` (default 24)
- Proper `lockLifetime` (`AGENDA_LOCK_MS`, default 10m)
- Daily limit & reset based on **site timezone**
- Health endpoint exposes server time, timezone, and offset
- Basic CORS allowlist + Helmet + JSON limit
- Minimal React admin (optional)

## Run (development)
1. Start MongoDB locally or set `MONGO_URI` in `.env` (copy `.env.example`).
2. **Server**
   ```bash
   cd server
   npm i
   cp .env.example .env
   npm run dev
   ```
3. **Client** (optional UI)
   ```bash
   cd ../client
   npm i
   npm run dev
   ```

## Deploy
- Build the client (`npm run build`) and serve from the server automatically.
- Scale scheduler by running **multiple worker processes** (same code) — Agenda will coordinate via MongoDB locks.

## WP Plugin Contract
- Ping: `POST/GET {site.url}/wp-json/ab/v1/ping` with header `x-api-key: <apiKey>`
- Post: `POST {site.url}/wp-json/ab/v1/post` JSON body `{ title, content }` and header `x-api-key: <apiKey>`

Adjust endpoints in `server/lib/jobs.js` if your plugin uses different paths.
