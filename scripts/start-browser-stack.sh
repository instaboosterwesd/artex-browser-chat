#!/usr/bin/env bash
# Start a visible Chromium desktop for ARTEX browser automation + live noVNC preview.
# - Xvfb :99  (virtual display the headed Playwright / Chrome windows land on)
# - openbox   (window manager)
# - x11vnc    (VNC of that display)
# - websockify+noVNC on :6080  (browser iframe /live-browser/)
set -euo pipefail

DISPLAY_NUM="${ARTEX_BROWSER_DISPLAY:-99}"
VNC_PORT="${ARTEX_VNC_PORT:-5900}"
WS_PORT="${ARTEX_NOVNC_PORT:-6080}"
NOVNC_WEB="${ARTEX_NOVNC_WEB:-$HOME/noVNC}"
export DISPLAY=":${DISPLAY_NUM}"
export PATH="/usr/bin:$HOME/.local/bin:$PATH"

mkdir -p "$HOME/.artex-browser" /tmp/artex-browser
cd "$HOME/.artex-browser"

# Clean previous stack for this display (leave unrelated processes alone).
pkill -f "Xvfb :${DISPLAY_NUM}" 2>/dev/null || true
pkill -f "x11vnc.*rfbport ${VNC_PORT}" 2>/dev/null || true
pkill -f "websockify.*${WS_PORT}" 2>/dev/null || true
sleep 1

echo "[browser-stack] Xvfb :${DISPLAY_NUM}"
Xvfb ":${DISPLAY_NUM}" -screen 0 1400x900x24 -ac +extension GLX +render -noreset \
  >"/tmp/artex-browser/xvfb.log" 2>&1 &
sleep 1

echo "[browser-stack] openbox"
openbox >"/tmp/artex-browser/openbox.log" 2>&1 &
sleep 0.5

echo "[browser-stack] x11vnc :${VNC_PORT}"
x11vnc -display ":${DISPLAY_NUM}" -forever -nopw -shared -rfbport "${VNC_PORT}" -bg \
  -o "/tmp/artex-browser/x11vnc.log"

echo "[browser-stack] noVNC websockify :${WS_PORT} (web=${NOVNC_WEB})"
if [[ ! -f "${NOVNC_WEB}/vnc.html" ]]; then
  echo "[browser-stack] ERROR: ${NOVNC_WEB}/vnc.html missing" >&2
  exit 1
fi
# Prefer local websockify binary; fall back to python module.
if command -v websockify >/dev/null 2>&1; then
  websockify --web "${NOVNC_WEB}" "${WS_PORT}" "127.0.0.1:${VNC_PORT}" \
    >"/tmp/artex-browser/websockify.log" 2>&1 &
else
  python3 -m websockify --web "${NOVNC_WEB}" "${WS_PORT}" "127.0.0.1:${VNC_PORT}" \
    >"/tmp/artex-browser/websockify.log" 2>&1 &
fi
sleep 1

# Keep bsk daemon alive for browser-skill (CLI skill path).
if command -v bsk >/dev/null 2>&1; then
  if ! BSK_AUTO_START=0 bsk status --json >/dev/null 2>&1; then
    echo "[browser-stack] starting bsk daemon"
    bsk daemon start >/dev/null 2>&1 || true
  else
    echo "[browser-stack] bsk daemon already running"
  fi
fi

echo "[browser-stack] ready DISPLAY=${DISPLAY} novnc=http://127.0.0.1:${WS_PORT}/vnc.html?autoconnect=1&resize=scale"
