# v17-ai-prompt-wizard

- Added AI Prompt Wizard in Prompt Studio.
- Added backend endpoint: POST /api/sites/:id/prompt/generate.
- Added backend endpoint: POST /api/sites/:id/prompt/activate-ai.
- Added safe prompt generator and prompt validation logic.
- Added bridge endpoint: POST /wp-json/grb/v1/prompt/generate.
- Bridge v17 can use the Gemini key already saved in WordPress.
- Added CSV per-post Prompt column support across dashboard, bridge, and SEM SEO BLOGER plugin.
- SEM SEO BLOGER now passes row-level prompt override to Gemini generation.
- Strengthened default finance/SEBI-safe prompt restrictions.
- Preserved v16 fresh client backend/login proxy behavior.

## v18-random-hourly-scheduler
- Added Random hourly schedule mode.
- Supports 1 post every N hours with random minute and second inside that hour block.
- Added randomHours, randomMinuteMin, randomMinuteMax and nextRandomRunAt site fields.
- Random hourly jobs reschedule themselves after each run.
- Kept v17 AI Prompt Wizard and v16 fresh client backend proxy fixes.

# v18-random-hourly-scheduler

- Added Random hourly schedule mode.
- Added randomHours, randomMinuteMin, randomMinuteMax, and nextRandomRunAt site fields.
- Scheduler now creates one one-time Agenda job per site, then re-schedules the next random run after each execution.
- Use Random hrs = 1 for one post per hour with random minute/second timing.
- Added UI controls in Sites table for random hourly interval and minute range.
- Preserved v17 AI Prompt Wizard and v16 client login proxy fixes.
