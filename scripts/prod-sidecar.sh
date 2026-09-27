#!/usr/bin/env bash
# Start the stateless Lighter signer sidecar for production use.
#
# Same singleton model as scripts/dev-sidecar.sh (one shared sidecar serves
# every Lighter consumer; it holds no credentials at rest). Difference from
# dev: this script never bootstraps the venv — run `npm run dev:sidecar` once
# to create it, then this script fails fast with a clear error instead of
# running `pip install` during a prod boot.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR_DIR="$ROOT/sidecar/lighter-signer"

# Load repo .env so SIDECAR_AUTH_TOKEN matches what backend/engine send.
#
# The file may carry CRLF line endings; strip CR before sourcing so a sourced
# `SIDECAR_AUTH_TOKEN=…\r` still matches the token Node's dotenv loads.
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . <(sed 's/\r$//' "$ROOT/.env")
  set +a
fi

# Bind the port the clients actually call: LIGHTER_SIDECAR_URL is their single
# source of truth (default http://127.0.0.1:8790). Deriving it here keeps one
# knob — a second, drifting port variable would silently break both consumers.
PORT="$(
  printf '%s' "${LIGHTER_SIDECAR_URL:-}" |
    tr -d '\r' |
    sed -nE 's#.*:([0-9]+)/?$#\1#p'
)"
PORT="${PORT:-8790}"

if [ ! -x "$SIDECAR_DIR/.venv/bin/uvicorn" ]; then
  echo "[prod-sidecar] missing venv: $SIDECAR_DIR/.venv" >&2
  echo "[prod-sidecar] run \`npm run dev:sidecar\` once to bootstrap it, then retry." >&2
  exit 1
fi

cd "$SIDECAR_DIR"
echo "[prod-sidecar] uvicorn on 127.0.0.1:$PORT (SIDECAR_AUTH_TOKEN ${SIDECAR_AUTH_TOKEN:+set}${SIDECAR_AUTH_TOKEN:-unset})"
exec ./.venv/bin/uvicorn app:app --host 127.0.0.1 --port "$PORT"
