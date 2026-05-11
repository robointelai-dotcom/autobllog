# Patch Log — v2.0 Reliability Build

## Critical logical fixes
- Queue row is no longer removed before successful WordPress post creation.
- Empty queue / cooldown / daily-limit runs now log as `skipped`, not fake success.
- `skipped` status added to log schema to stop Mongoose validation errors.
- Removed duplicate immediate schedule trigger on site update.
- Fixed bridge `Backlink` vs plugin `BacklinkURL` mismatch.
- Fixed queue site selection race in React UI.
- Fixed WordPress cron being cleared on every page load.

## Security and reliability
- Added admin nonces/capability checks in WordPress plugin.
- Added dashboard admin key support.
- Added URL, ObjectId, timezone, schedule, queue, and field validation.
- Added bridge request timeout/retry helper.
- Masked API keys in dashboard API responses.
- Added global Express async error handler.
- Added graceful Agenda/MongoDB shutdown.
- Updated npm lockfiles; client and server audit clean at build time.

## UI upgrade
- Full dashboard redesign with modern colors, cards, KPI panels, responsive layout, toast notifications, queue view, logs view, and schedule controls.
- WordPress plugin admin UI redesigned with queue preview, history, clear actions, browser auto-run and cron controls.


## v3.0 Smart CSV Auto Update
- Added dashboard CSV Smart Sync mode: update existing queue rows by Keyword and append new rows.
- Added Append New, Mirror CSV, and Replace Queue modes.
- Added duplicate cleanup by Keyword, skip-already-published protection, and detailed sync statistics.
- Added WordPress plugin CSV Auto Update UI with safe modes and last-sync status.
- Added Remote Bridge `/queue/sync` endpoint and dashboard `/api/queue/sync` route.
- Queue rows continue to be removed only after successful post publishing.
