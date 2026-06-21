#!/usr/bin/env bash
# BAR map generator — stop the backend.
pkill -f "node server.js" 2>/dev/null || true
rm -f /home/leock/bargen/site/server.pid
echo stopped
