# AutoBlog Pro v10 Plugin Manager Final

Remote Controller dashboard for WordPress SEM SEO BLOGER automation with full WordPress plugin management.

## Features

- Smart CSV Auto Update to WordPress queue
- Gemini API Key Manager
- Prompt Studio for Gemini article prompt editing
- Blog Update History
- New Plugin Manager: upload plugin ZIP, activate, deactivate, reactivate and remove plugins
- Remote Bridge diagnostics and secure plugin-management endpoints
- World-class themed dashboard UI

## WordPress plugin install order

1. `sem-seo-bloger-v3.2-smart-csv-v9-prompt-studio.zip`
2. `wp-gamini-remote-bridge-1.3-plugin-manager-v10.zip`

The Plugin Manager requires the v10 Remote Bridge plugin because plugin upload/remove/reactivate runs through `/wp-json/grb/v1/plugins`.

## Server

```bash
cd /opt/autoblog/server
npm install --no-audit --no-fund --legacy-peer-deps --ignore-scripts
npm start
```

## Client

```bash
cd /opt/autoblog/client
npm install --no-audit --no-fund --legacy-peer-deps --ignore-scripts
npm run build
```

## Health check

```bash
curl -s https://domaincontroller.in/api/healthz
```

Expected appVersion: `v10-plugin-manager-final`.

## Dashboard test after update

1. Open dashboard with cache-bust, for example `https://domaincontroller.in/?v=10`.
2. Press Ctrl + Shift + R.
3. API Keys -> Load remote status -> Test Gemini.
4. Queue -> Sync CSV to WordPress.
5. Prompt Studio -> Load prompt -> Save prompt -> Reset default test.
6. Plugin Manager -> Select site -> Load plugins -> upload a small test plugin ZIP -> deactivate/reactivate test.
7. Blog History -> Refresh history.
