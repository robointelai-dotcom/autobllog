# AutoBlog Pro v7 - World Class Remote Controller

Premium remote dashboard for CSV → Gemini → WordPress automation.

## v7 highlights

- World-class glassmorphism dashboard redesign
- Remote Controller Command Center home screen
- Theme Studio with Aurora, Royal, Emerald and Sunset palettes
- Smart CSV Auto Update v7 queue workflow
- Gemini API key manager retained
- Blog update history retained
- Reliability logs, bridge checks, queue sync and WordPress post actions retained

## Server

```bash
cd /opt/autoblog/server
npm install --no-audit --no-fund --legacy-peer-deps

cd /opt/autoblog/client
npm install --no-audit --no-fund --legacy-peer-deps
npm run build

pm2 restart all
```

## WordPress plugins

Upload the two plugin ZIP files from `release-plugins` or the final package.

1. SEM SEO BLOGER v7 compatible
2. Remote Bridge v7 compatible
