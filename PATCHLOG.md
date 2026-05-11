# Patch Log — 2025-09-11T11:17:21.381383

## Client
- Replaced naive `parseCsv` with RFC4180-like parser; supports quotes, Unicode, BOM; header alias for `BacklinkURL`.
- Added CSV file input (`accept=".csv,text/csv"`) that populates text area and preview.

## Server
- Timezone helper `tzFor(site)` with fallback to `DEFAULT_TIMEZONE` env (Asia/Colombo).
- Validated `dailyAt` and `scheduleCron`; pass timezone from `tzFor(site)`.
- Optional immediate run on schedule save (`RUN_IMMEDIATE_ON_SAVE=true`).
- Concurrency configurable (`JOB_CONCURRENCY`, default 5).
- Daily limit resets by site timezone, not UTC.
- Queue append validation: array, size limit (≤5000), `Keyword` required.
- Optional admin key guard for non-GET routes; uses `x-admin-key` or `?key=`.

## Env Example
- Added `DEFAULT_TIMEZONE=Asia/Colombo`, `RUN_IMMEDIATE_ON_SAVE=true`, `JOB_CONCURRENCY=5`.
