# AutoBlog Pro v18 - Random Hourly Scheduler

Version: v18-random-hourly-scheduler

New feature:
- Random Hourly schedule mode for each WordPress site.
- Set Random hrs = 1 for 1 post per hour.
- Set random minute range, for example 0 to 59, so each hour publishes at a different minute/second.
- Dashboard stores nextRandomRunAt so you can see the next random run time.
- Works for main dashboard and every fresh client backend instance.
- Keeps v17 AI Prompt Wizard, per-site Gemini prompt, client instances, delete client, and client login proxy fixes.

How to use:
1. Open Sites.
2. Select schedule mode: Random hourly.
3. Set Random hrs = 1.
4. Set Random minute min = 0 and Random minute max = 59.
5. Enable the site.
6. The system schedules one post in the next hour block at a random minute/second, then schedules the next random time after each successful/attempted run.

Recommended settings for 1 post per hour:
- Mode: Random hourly
- Random hrs: 1
- Random minute min: 0
- Random minute max: 59
- Daily limit: optional safety cap

Important:
- Fixed Every hours mode remains available, but it posts at a fixed repeat interval.
- Random hourly mode is for human-like non-same-time scheduling.
