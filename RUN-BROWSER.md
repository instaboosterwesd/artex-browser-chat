# Run ARTEX + Live Browser Chat

This checkout adds **Open Browser** under the chat box (tabs only), shared headed Chrome (CDP), and Playwright MCP wired to that Chrome.

## Requirements (Linux amd64)

- PostgreSQL (see main README / `docker compose`)
- Google Chrome / Chromium
- Node.js 20+
- `cloudflared` optional (public URL)
- Xvfb + x11vnc + websockify + noVNC (for headed Chrome on a server)

```bash
# Debian/Ubuntu-ish
sudo apt-get install -y xvfb x11vnc openbox google-chrome-stable
npm i -g websockify   # or: pip install --user websockify
# clone noVNC to ~/noVNC if missing
```

## Quick start

```bash
cd ARTEX   # this repo

# 1) Postgres + config (copy examples; do NOT commit real secrets)
cp config.example.json config.json   # edit DB password
cp .env.example .env                 # optional LLM keys

# 2) Binary
chmod +x bin/artex-linux-amd64 start.sh start-with-browser.sh
ln -sf bin/artex-linux-amd64 ./artex

# 3) Frontend static (already built in CI-less flow):
cd web && npm ci && npm run build:static && cd ..

# 4) Gateway deps
cd scripts && npm ci && cd ..

# 5) Start stack (Xvfb + Chrome CDP + bridge + ARTEX + gateway :8790)
./start-with-browser.sh
```

Open **http://127.0.0.1:8790/chat** → login/setup → under the message box click **Open Browser**.

Public tunnel (optional):

```bash
cloudflared tunnel --url http://127.0.0.1:8790
```

## Chat browser UX

- **Open Browser** under the composer
- Tab strip only (not the Linux desktop)
- Click a tab to view it; **✕** closes that tab
- Click / scroll on the page image to interact with the real Chrome tab
- New chat → new tab (agent should use `browser_tabs` for new work)

## MCP

DB seed enables MCP server `browser` with:

`--cdp-endpoint http://127.0.0.1:9222`

Bridge API: `http://127.0.0.1:9223` (proxied at `/browser-bridge` via gateway).
