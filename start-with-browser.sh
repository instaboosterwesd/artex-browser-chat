#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/usr/bin:$HOME/.local/bin:$PATH"
export DISPLAY=:99
export NPM_CONFIG_PREFIX="$HOME/.local"

bash ./scripts/start-browser-stack.sh
bash ./scripts/start-open-connector.sh || echo "[warn] Open Connector failed to start (Connections → Open Connector)"

PROFILE="$HOME/.artex-browser/cdp-profile"
mkdir -p "$PROFILE"
if ! curl -sf http://127.0.0.1:9222/json/version >/dev/null; then
  pkill -f 'remote-debugging-port=9222' 2>/dev/null || true
  sleep 1
  nohup google-chrome-stable \
    --remote-debugging-port=9222 \
    --remote-debugging-address=127.0.0.1 \
    --user-data-dir="$PROFILE" \
    --no-first-run --no-default-browser-check --disable-sync \
    --no-sandbox --disable-gpu \
    --window-size=1280,800 --window-position=0,0 \
    about:blank >/tmp/chrome-cdp.log 2>&1 &
  sleep 3
fi

pkill -f 'browser-bridge.js' 2>/dev/null || true
( cd scripts && nohup env DISPLAY=:99 node browser-bridge.js >/tmp/browser-bridge.log 2>&1 & )
sleep 2

if ! ss -ltn | grep -q ':8787'; then
  nohup env DISPLAY=:99 PATH="/usr/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" \
    HOME="$HOME" PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" \
    NPM_CONFIG_PREFIX="$HOME/.local" ./start.sh >artex.log 2>&1 &
  sleep 2
fi

pkill -f 'artex-gateway.js' 2>/dev/null || true
( cd scripts && nohup env ARTEX_STATIC_ROOT="$(pwd)/../web/out" node artex-gateway.js >/tmp/artex-gateway.log 2>&1 & )
sleep 1
echo "Ready: gateway :8790  Open Browser under chat composer. Bridge :9223  CDP :9222"
