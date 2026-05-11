# AutoBlog Control Center v2.0 Reliability Build

A hardened React + Node + MongoDB dashboard for triggering the WordPress **Robointel AutoBlog Remote Bridge** and the **SEM SEO BLOGER** Gemini auto-poster plugin.

## What was fixed

### Dashboard / server
- Fixed `skipped` log validation crash by adding `skipped` to the JobLog schema.
- Fixed duplicate immediate runs when saving schedules.
- Added strict site ID, URL, schedule, timezone, and queue validation.
- Added bridge request timeouts, retries, and safer JSON/text error handling.
- Added `MONGO_URI` support while keeping `MONGO_URL` compatibility.
- Added protected admin-key support using `API_KEY` / `ADMIN_KEY` and `x-admin-key`.
- Added CORS allowlist support through `CORS_ORIGINS`.
- Masked saved bridge API keys from `/api/sites` responses.
- Added clean async error handling so bad requests do not crash Express.
- Added graceful shutdown for Agenda + MongoDB.
- Added daily-limit logic that does not count empty/skipped WordPress queue runs as successful posts.
- Updated npm lockfiles and verified `npm audit` shows zero vulnerabilities for server and client.

### Dashboard / client
- Rebuilt UI style from scratch with a modern dark control center design.
- Added admin-key field stored locally in the browser.
- Added global error/success toast messages.
- Fixed queue site selection loading the wrong old site ID.
- Added CSV parser aliases for `BacklinkURL`, `image_url`, etc.
- Added daily-limit editing from the Sites table.
- Added responsive layout and scroll-safe tables.

### WordPress bridge
- Added GET/POST ping support.
- Added secure generated API key on activation.
- Added better status output and limited history response.
- Fixed queue append count to report only accepted rows.
- Added support for `Backlink`, `BacklinkURL`, `image`, `Image`, and `image_url`.

### SEM SEO BLOGER plugin
- Fixed security order so direct file access exits before WordPress functions run.
- Removed the dangerous “clear cron on every request” behavior.
- Added nonces and capability checks to all admin actions.
- Fixed queue reliability: a row is removed only after a post is successfully published.
- Fixed bridge compatibility: supports `Backlink` as well as `BacklinkURL`.
- Added overlap lock so two jobs do not publish the same queue row at the same time.
- Fixed Gemini API failures so they do not create/publish error-message posts.
- Added better featured image handling and warnings.
- Added clean admin UI, history, queue preview, clear buttons, and browser auto-run control.

## Folder layout

```text
client/   React dashboard UI
server/   Node/Express API + Agenda scheduler
```

WordPress plugin ZIPs are provided separately:

```text
wp-gamini-remote-bridge-1.1-fixed.zip
sem-seo-bloger-v3.1-fixed.zip
```

## Server setup

```bash
cd server
cp .env.example .env
npm install
npm start
```

Edit `.env` first:

```env
PORT=4000
MONGO_URI=mongodb://127.0.0.1:27017/remotecontroller
API_KEY=change-this-admin-key
CORS_ORIGINS=https://your-dashboard-domain.com
DEFAULT_TIMEZONE=Asia/Colombo
RUN_IMMEDIATE_ON_SAVE=false
```

## Client setup

```bash
cd client
npm install
npm run build
```

For development:

```bash
cd client
npm run dev
```

The server automatically serves `client/dist` when it exists.

## WordPress setup

1. Install and activate `sem-seo-bloger-v3.1-fixed.zip`.
2. Add your Gemini API key in **Gemini SEO**.
3. Install and activate `wp-gamini-remote-bridge-1.1-fixed.zip`.
4. Copy the Bridge API key from **AutoBlog Bridge**.
5. In the dashboard, add the WordPress site URL and the same Bridge API key.
6. Test with **Ping**.
7. Upload CSV rows and click **Post now**.

## CSV columns

Required:

```csv
Keyword
```

Optional:

```csv
Topic,Category,Tags,image,Backlink
```

Aliases supported:

```csv
BacklinkURL,backlink_url,Image,image_url
```

## Production notes

- Keep MongoDB private.
- Use HTTPS for the dashboard and WordPress site.
- Set `API_KEY` in the server `.env`; then enter the same key in the dashboard sidebar **Admin Key** field.
- Set `CORS_ORIGINS` to your dashboard domain in production.
- Use PM2/systemd to keep the server running.

## v3 Smart CSV Auto Update

Use the Queue tab for CSV changes:

- **Smart Sync**: best default. Updates existing rows by `Keyword`, appends new keywords, and keeps old queue rows.
- **Append New**: only adds rows whose keyword is not already queued.
- **Mirror CSV**: makes the WordPress queue exactly match the uploaded CSV after duplicate cleanup.
- **Replace**: clears the queue and loads the CSV.

The dashboard and WordPress plugin skip already published keywords by default using post history and the `rank_math_focus_keyword` post meta created by the plugin.
