#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/usr/bin:$PATH"
exec python3 "$(pwd)/server.py" "$@"
