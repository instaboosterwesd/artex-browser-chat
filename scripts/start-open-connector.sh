#!/usr/bin/env bash
# Start OpenConnector (https://github.com/oomol-lab/open-connector) for ARTEX Connections.
# Default: local open mode (no admin/runtime bearer) so MCP at :3000/mcp works for ARTEX.
# Set OPEN_CONNECTOR_SECURE=1 to require tokens from open-connector.env.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$ROOT/open-connector.env"
COMPOSE="$ROOT/open-connector/docker-compose.yml"

mkdir -p "$ROOT/open-connector"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[open-connector] generating secrets → $ENV_FILE"
  {
    echo "OOMOL_CONNECT_ENCRYPTION_KEY=$(openssl rand -base64 32)"
    echo "# Optional (OPEN_CONNECTOR_SECURE=1):"
    echo "OOMOL_CONNECT_ADMIN_TOKEN=$(openssl rand -base64 32)"
    echo "OOMOL_CONNECT_RUNTIME_TOKEN=$(openssl rand -base64 32)"
    echo "OOMOL_CONNECT_ORIGIN=http://127.0.0.1:3000"
  } >"$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

# shellcheck disable=SC1090
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

export OOMOL_CONNECT_ENCRYPTION_KEY
export OOMOL_CONNECT_ORIGIN="${OOMOL_CONNECT_ORIGIN:-http://127.0.0.1:3000}"

if [[ "${OPEN_CONNECTOR_SECURE:-}" == "1" ]]; then
  export OOMOL_CONNECT_ADMIN_TOKEN OOMOL_CONNECT_RUNTIME_TOKEN
  echo "[open-connector] secure mode (admin + runtime bearer required)"
else
  # Local ARTEX: leave auth open so HTTP MCP attaches without pasting tokens.
  unset OOMOL_CONNECT_ADMIN_TOKEN OOMOL_CONNECT_RUNTIME_TOKEN || true
  export OOMOL_CONNECT_ADMIN_TOKEN=""
  export OOMOL_CONNECT_RUNTIME_TOKEN=""
  echo "[open-connector] open local mode (no bearer) — set OPEN_CONNECTOR_SECURE=1 for tokens"
fi

echo "[open-connector] starting ghcr.io/oomol-lab/open-connector:latest on :3000"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE" up -d --force-recreate

for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:3000/health" >/dev/null 2>&1; then
    echo "[open-connector] ready  console=http://127.0.0.1:3000  mcp=http://127.0.0.1:3000/mcp  via-gateway=/open-connector/"
    exit 0
  fi
  sleep 2
done

echo "[open-connector] started but health check timed out — check: docker logs artex-open-connector" >&2
exit 1
