# AutoBlog Pro v13 - Fresh Client Instances

This release fixes the v12 limitation where client URLs used the same backend process with isolated tenant databases.

v13 creates a fresh backend app instance for every client page name:

- `/` = main dashboard backend on port `4000`
- `/global1/` = dedicated Node backend process on port `4100+`
- Every client has its own Mongo database
- Every client has its own dashboard username/password file
- Every client has its own logs and process status
- Main app only works as a lightweight router/proxy to each client backend

Default temporary login for main and every new client:

```txt
admin
admin@2020
```

After first login, go to Security and change the password.

## Health checks

Main:

```bash
curl -s https://domaincontroller.in/api/healthz
```

Client:

```bash
curl -s https://domaincontroller.in/global1/api/healthz
```

Expected app version:

```json
"appVersion":"v13-fresh-client-instances"
```

## Client instance logs

```bash
tail -100 /opt/autoblog-clients/global1/logs/server.log
```

## Important

Do not use the old v12 `/api/t/global1/...` route. v13 client API is:

```txt
/global1/api/...
```

## v17 AI Prompt Wizard

Prompt Studio now has an AI Prompt Wizard. Select a site, generate a careful Gemini prompt, review warnings, then click Save + Activate AI Auto Generate.

CSV post-by-post prompt support:
Add a column named `Prompt`, `CustomPrompt`, `PostPrompt`, or `AI Prompt`. That row-specific instruction is used only for that post and cannot override safety/compliance/HTML rules.

Updated WordPress plugin zips are in `release-plugins/`:
- sem-seo-bloger-v3.3-ai-prompt-v17.zip
- wp-gamini-remote-bridge-1.4-ai-prompt-v17.zip

## v18 Random Hourly Scheduler

Sites now support Random hourly mode. Use this when you want posts to publish at human-like times instead of the same fixed minute.

Recommended setup for one post per hour:
- Schedule mode: Random hourly
- Random hrs: 1
- Random minute min: 0
- Random minute max: 59

The dashboard stores the next random run as `nextRandomRunAt` and reschedules a fresh random time after every run.
