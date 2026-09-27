#!/usr/bin/env bash
# Start the stateless Lighter signer sidecar with the dev stack.
#
# One shared sidecar serves every Lighter consumer (credential connect/verify,
# dashboard portfolio reads, engine order signing) — it holds no credentials
# at rest, so per-strategy instances would buy nothing. Started by
# `npm run dev` (root package.json) or standalone: `npm run dev:sidecar`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR_DIR="$ROOT/sidecar/lighter-signer"

# Load repo .env so SIDECAR_AUTH_TOKEN matches what backend/engine send.
#
# The file is authored with CRLF line endings (as `.env.example` is), and `source`
# keeps the CR: a bare "\r" line is a command-not-found that aborts this script
# under `set -e`, and a sourced `SIDECAR_AUTH_TOKEN=…\r` would not match the token
# Node's dotenv loads. Strip CR before sourcing so both consumers agree.
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

cd "$SIDECAR_DIR"
if [ ! -d .venv ]; then
  echo "[dev-sidecar] bootstrapping venv…"
  python3 -m venv .venv
  ./.venv/bin/pip install --quiet -r requirements.txt
fi

echo "[dev-sidecar] uvicorn on 127.0.0.1:$PORT (SIDECAR_AUTH_TOKEN ${SIDECAR_AUTH_TOKEN:+set}${SIDECAR_AUTH_TOKEN:-unset})"
exec ./.venv/bin/uvicorn app:app --host 127.0.0.1 --port "$PORT"
