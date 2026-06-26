# AutoBlog Pro v18.3 — Deep Stability Fix

This release contains the matching Node/React dashboard and two WordPress plugins.

## Required matching versions

- Dashboard/API: `v18.3-deep-stability-fix`
- SEM SEO BLOGER: `5.6.0`
- Robointel AutoBlog Remote Bridge: `2.8.0`

## Important fixes

- Fixes the REST/cron category crash: `Call to undefined function wp_create_category()`.
- Uses runtime-safe taxonomy APIs and protects simultaneous category creation.
- Adds atomic publisher, queue-sync, and Bridge request locks.
- Stops rapid duplicate manual triggers and overlapping Browser Auto requests.
- Uses a 240-second minimum publisher timeout so Gemini/featured-image work is not falsely reported as timed out after 45 seconds.
- Uses one request ID across retries and caches completed Bridge results.
- Cleans a recently published stale queue row after a process crash instead of creating a duplicate post.
- Reloads and updates the latest queue under a short lock, preventing CSV sync from restoring a published row.
- Keeps each image only as the featured image and removes failed temporary attachments/drafts.
- Appends per-row CSV Prompt instructions without replacing site safety and HTML rules.
- Fixes `skipPublished` so old published rows are removed and counted once.
- Migrates retired Gemini 2.0 defaults to `gemini-2.5-flash`.
- Parses multipart Gemini responses and rejects empty successful responses.
- Prevents Bridge/API keys from appearing in transport error URLs.
- Protects the Bridge and SEM plugins from remote deactivate/delete actions.
- Executes normal WordPress plugin activation/deactivation hooks.
- Adds authenticated REST permission callbacks on every Bridge endpoint.
- Uses same-origin CORS by default and accepts the optional admin key only through a header.
- Fixes subpath assets for `/global1/` and other isolated client applications.
- Detects occupied client ports without killing unrelated services.
- Verifies that a responding client port belongs to the expected client slug.
- Parallelizes client health checks and returns a useful saved/error state if a new child process cannot start.
- Uses a dedicated large JSON limit only for plugin upload; normal API requests remain smaller.
- Limits queue sync requests and the saved queue to 5,000 rows and safely handles missing/malformed JSON payloads.
- Validates all remote settings before saving any of them, preventing partial Bridge-key rotation.
- Verifies and recovers a new Bridge key if the original save response is interrupted.
- Rejects too-short Bridge keys in WordPress admin while preserving the working key.
- Rejects site URLs containing embedded credentials and returns controlled 400/409/413 errors for invalid requests.
- Redacts secrets from Bridge responses, stored errors, dashboard API responses, and server error logs.
- Uses owner-token process locks and Linux PID ownership checks to avoid stale lock/PID races.
- Loads WordPress media libraries only during featured-image work instead of on normal frontend requests.

## Install order

1. Back up WordPress, `/opt/autoblog`, `server/.env`, and `server/data`.
2. Replace **SEM SEO BLOGER** with `sem-seo-bloger-v5.6.0-deep-stability-fix.zip`.
3. Replace **Remote Bridge** with `wp-gamini-remote-bridge-v2.8.0-deep-stability-fix.zip`.
4. Replace the dashboard code with `autobllog-main-v18.3-deep-stability-fix.zip` while preserving your existing `server/.env` and `server/data`.
5. Compare your existing `.env` with the included `.env.example`, especially the timeout and upload-size settings.
6. Run `npm ci --omit=dev` in `server`, run `npm ci && npm run build` in `client`, and restart the one process manager your server already uses.
7. Hard refresh the browser and complete the final live test in `INSTALL-STEPS.txt`.

Do not leave an old copy of either WordPress plugin active under another folder. WordPress should show one active SEM plugin and one active Bridge plugin.
