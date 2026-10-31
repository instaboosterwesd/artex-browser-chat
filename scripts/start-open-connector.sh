#!/usr/bin/env bash
# Start Open Connector (oomol-lab/open-connector) + optional public tunnel URL file.
set -euo pipefail

OC_DIR="${OPEN_CONNECTOR_DIR:-$HOME/open-connector}"
if [[ ! -f "$OC_DIR/docker-compose.yml" ]]; then
  echo "[open-connector] cloning upstream → $OC_DIR"
  git clone --depth 1 https://github.com/oomol-lab/open-connector.git "$OC_DIR"
fi

cd "$OC_DIR"
if [[ ! -f .env ]]; then
  cat > .env <<EOF
OOMOL_CONNECT_DATA_DIR=/app/data
OOMOL_CONNECT_ENCRYPTION_KEY=$(openssl rand -hex 32)
OOMOL_CONNECT_ADMIN_TOKEN=
OOMOL_CONNECT_RUNTIME_TOKEN=
OOMOL_CONNECT_ORIGIN=http://127.0.0.1:3000
EOF
fi

if [[ -n "${OPEN_CONNECTOR_PUBLIC_URL:-}" ]]; then
  if grep -q '^OOMOL_CONNECT_ORIGIN=' .env; then
    sed -i "s|^OOMOL_CONNECT_ORIGIN=.*|OOMOL_CONNECT_ORIGIN=${OPEN_CONNECTOR_PUBLIC_URL}|" .env
  else
    echo "OOMOL_CONNECT_ORIGIN=${OPEN_CONNECTOR_PUBLIC_URL}" >> .env
  fi
fi

echo "[open-connector] starting from $OC_DIR"
docker compose --env-file .env up -d

for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:3000/health >/dev/null 2>&1 || curl -sf http://127.0.0.1:3000/v1/providers >/dev/null 2>&1; then
    count=$(curl -sf http://127.0.0.1:3000/v1/providers | python3 -c 'import sys,json; print(len(json.load(sys.stdin).get("data") or []))' 2>/dev/null || echo "?")
    echo "[open-connector] ready  console=http://127.0.0.1:3000  providers=$count  mcp=http://127.0.0.1:3000/mcp"
    exit 0
  fi
  sleep 1
done

echo "[open-connector] health check timed out" >&2
docker compose logs --tail 40 || true
exit 1
