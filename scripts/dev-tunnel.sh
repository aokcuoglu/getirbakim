#!/usr/bin/env bash
set -euo pipefail

# ── Dev server + prod DB tunnel in one command ───────────────────────────────
#
# Local dev talks to the PRODUCTION Postgres (see .env.local), which is only
# reachable through an SSH tunnel to the VPS loopback. Running `next dev`
# without that tunnel fails at the first query, so this script opens it first
# and tears it down when dev exits.
#
# An already-open tunnel (a manual `ssh -N -L ...` in another terminal) is
# reused as-is and left running on exit — we only kill what we started.
#
# Usage: bun run dev:tunnel
# Env overrides: TUNNEL_HOST, TUNNEL_REMOTE_PORT, TUNNEL_PORT, DEV_PORT

TUNNEL_HOST="${TUNNEL_HOST:-root@173.249.36.2}"
TUNNEL_REMOTE_PORT="${TUNNEL_REMOTE_PORT:-5432}"
DEV_PORT="${DEV_PORT:-3001}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Read the last uncommented assignment of a key from an env file. .env.local
# keeps the local-DB DSN as commented-out lines, so a naive grep picks the
# wrong one.
env_value() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  grep -E "^[[:space:]]*${key}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"'\r' || true
}

# The tunnel port is whatever the dev server's DSN points at, so the two can
# never drift apart.
DATABASE_URL="$(env_value "${ROOT_DIR}/.env.local" DATABASE_URL)"
if [[ -z "${TUNNEL_PORT:-}" ]]; then
  if [[ "$DATABASE_URL" =~ @(127\.0\.0\.1|localhost):([0-9]+)/ ]]; then
    TUNNEL_PORT="${BASH_REMATCH[2]}"
  else
    echo "dev:tunnel: .env.local DATABASE_URL does not point at a local port." >&2
    echo "            Nothing to tunnel — run 'bun run dev' instead." >&2
    exit 1
  fi
fi

port_is_open() {
  nc -z 127.0.0.1 "$TUNNEL_PORT" >/dev/null 2>&1
}

TUNNEL_PID=""
cleanup() {
  if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "dev:tunnel: closing SSH tunnel (pid ${TUNNEL_PID})"
    kill "$TUNNEL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if port_is_open; then
  echo "dev:tunnel: port ${TUNNEL_PORT} already forwarded — reusing existing tunnel"
else
  echo "dev:tunnel: opening ${TUNNEL_PORT} -> ${TUNNEL_HOST}:${TUNNEL_REMOTE_PORT}"
  ssh -N \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -L "${TUNNEL_PORT}:127.0.0.1:${TUNNEL_REMOTE_PORT}" \
    "$TUNNEL_HOST" &
  TUNNEL_PID=$!

  # ssh backgrounds before the forward is actually listening; wait for it.
  for _ in $(seq 1 30); do
    port_is_open && break
    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
      echo "dev:tunnel: SSH tunnel failed to start (is the VPS reachable?)" >&2
      exit 1
    fi
    sleep 0.5
  done

  if ! port_is_open; then
    echo "dev:tunnel: timed out waiting for port ${TUNNEL_PORT}" >&2
    exit 1
  fi
  echo "dev:tunnel: tunnel up (pid ${TUNNEL_PID})"
fi

exec_dev() {
  cd "$ROOT_DIR"
  # Not exec'd: the trap above must still run when dev exits.
  bunx next dev -p "$DEV_PORT"
}

exec_dev
