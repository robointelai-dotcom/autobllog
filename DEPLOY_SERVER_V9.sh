#!/usr/bin/env bash
set -euo pipefail
cd /opt/autoblog

git config --global --add safe.directory /opt/autoblog
cp -a /opt/autoblog /opt/autoblog-backup-$(date +%F-%H%M%S)

git fetch origin main
git reset --hard origin/main

source /root/.nvm/nvm.sh 2>/dev/null || true
npm config set registry https://registry.npmjs.org/

cd /opt/autoblog/server
rm -rf node_modules package-lock.json npm-shrinkwrap.json
npm install --registry=https://registry.npmjs.org/ --no-audit --no-fund --legacy-peer-deps --ignore-scripts

cd /opt/autoblog/client
rm -rf node_modules package-lock.json npm-shrinkwrap.json
npm install --registry=https://registry.npmjs.org/ --no-audit --no-fund --legacy-peer-deps --ignore-scripts
npm run build

pkill -f "node index.js" 2>/dev/null || true
pkill -f "npm.*start" 2>/dev/null || true
fuser -k 4000/tcp 2>/dev/null || true

cd /opt/autoblog/server
nohup npm start > /var/log/autoblog.log 2>&1 &
echo $! > /var/run/autoblog.pid

nginx -t && systemctl restart nginx
sleep 2
curl -s http://127.0.0.1:4000/api/healthz || true
