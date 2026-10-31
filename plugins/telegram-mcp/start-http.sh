#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/usr/bin:$PATH"
pkill -f 'plugins/telegram-mcp/http_api.py' 2>/dev/null || true
sleep 0.5
nohup python3 "$(pwd)/http_api.py" >/tmp/telegram-http.log 2>&1 &
echo $! >/tmp/telegram-http.pid
for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:8791/health >/dev/null; then
    echo "[telegram-http] ready :8791"
    exit 0
  fi
  sleep 0.3
done
echo "[telegram-http] failed to start" >&2
tail -20 /tmp/telegram-http.log >&2 || true
exit 1
