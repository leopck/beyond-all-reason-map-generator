#!/usr/bin/env bash
# BAR map generator — start the compile backend (survives logout via nohup).
cd /home/leock/bargen/site
pkill -f "node server.js" 2>/dev/null || true
sleep 0.5
PORT=${PORT:-8100} nohup /usr/bin/node server.js > server.log 2>&1 &
echo $! > server.pid
echo "started pid $(cat server.pid) on port ${PORT:-8100}"
