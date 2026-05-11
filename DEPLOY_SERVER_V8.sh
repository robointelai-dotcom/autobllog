#!/usr/bin/env bash
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/autoblog}"
REPO_URL="${REPO_URL:-https://github.com/robointelai-dotcom/autobllog.git}"
cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" || true
cp -a "$APP_DIR" "${APP_DIR}-backup-$(date +%F-%H%M%S)"
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"
git fetch origin main
git reset --hard origin/main
# stop old manual node/npm processes started from this app, but keep nginx/mongodb alive
pkill -f "$APP_DIR/server/index.js" 2>/dev/null || true
pkill -f "npm.*--prefix $APP_DIR/server" 2>/dev/null || true
source /root/.nvm/nvm.sh 2>/dev/null || true
cd "$APP_DIR/server"
rm -rf node_modules
npm install --no-audit --no-fund --legacy-peer-deps --ignore-scripts
cd "$APP_DIR/client"
rm -rf node_modules
npm install --no-audit --no-fund --legacy-peer-deps --ignore-scripts
npm run build
npm install -g pm2 --no-audit --no-fund
cd "$APP_DIR/server"
pm2 delete autoblog 2>/dev/null || true
pm2 start npm --name autoblog -- start
pm2 save
nginx -t && systemctl restart nginx || true
pm2 logs autoblog --lines 30
