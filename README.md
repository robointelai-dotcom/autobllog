# AutoBlog Pro v9 Prompt Studio Final

Remote Controller dashboard for WordPress SEM SEO BLOGER automation.

Features:
- Smart CSV Auto Update to WordPress queue
- Gemini API Key Manager
- Prompt Studio for Gemini article prompt editing
- Blog Update History
- Remote Bridge diagnostics
- World-class themed dashboard UI

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

Expected appVersion: `v9-prompt-studio-final`.
