# AutoBlog Pro release history

## v18.3 — Deep Stability Fix

- Fixed category creation during REST/cron publishing.
- Added atomic publishing, Bridge request, and CSV queue locks.
- Added rapid manual-trigger and Browser Auto overlap protection.
- Added safe long publisher timeout, retry idempotency, recent-crash duplicate cleanup, and queue refresh after publishing.
- Fixed per-row prompt precedence, `skipPublished`, failed image/draft cleanup, multipart Gemini parsing, and secret redaction.
- Hardened Bridge permissions and plugin lifecycle actions.
- Added same-origin CORS defaults, login throttling, session reset after credential changes, safe client port ownership checks, and relative subpath assets.
- Added route-specific plugin upload size/timeouts and improved child-instance proxy timing.
- Added owner-token publisher locks so an expired older request cannot release a newer run lock.
- Added 5,000-row queue safety limits and safe handling for missing/malformed REST JSON.
- Made Bridge settings changes transactional and added dashboard recovery after an interrupted API-key rotation.
- Rejected short Bridge keys in WordPress admin without disconnecting the current dashboard.
- Hardened URL/schedule/env validation, mapped bad JSON and duplicate database records to controlled HTTP errors, and redacted secrets from API logs.
- Added stale PID ownership checks so a reused Linux PID cannot terminate an unrelated process.
- Lazy-loaded WordPress media libraries only when a featured image is actually attached.

## v18.2 — Publisher Runtime Fix

- Replaced the unavailable admin-only category helper with runtime-safe taxonomy functions.
- Added initial retry request IDs, Gemini 2.5 migration, image cleanup, and frontend dependency refresh.

## v18 — Random Hourly Scheduler

- Added one post every N hours with a random minute/second.
- Added randomHours, randomMinuteMin, randomMinuteMax, and nextRandomRunAt.

## v17 — AI Prompt Wizard

- Added Prompt Studio AI generation, site prompts, CSV per-post Prompt support, and safe prompt validation.
