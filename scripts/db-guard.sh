#!/usr/bin/env bash
set -euo pipefail

# ── Guard rail for destructive Prisma commands ───────────────────────────────
#
# Why: `prisma migrate dev`, `prisma migrate reset` and `prisma db push` all
# reconcile the dev database against the datamodel by DROPPING whatever does not
# match. Against our local DB that is not a nuisance, it is data loss:
#
#   - local `public` holds the 129 GB TecDoc archive (part_vehicle_types alone is
#     931M rows / 119 GB) which exists nowhere else;
#   - local has no `_prisma_migrations` table, so Prisma treats it as unmanaged
#     and offers a full reset;
#   - `migrate diff` already shows 12 index drops and a `parts.part_no`
#     text -> bigint rewrite waiting to happen.
#
# So these three commands are never correct in this repository. Migrations are
# authored with `scripts/db-migration-new.sh` (which uses the read-only
# `migrate diff` against a throwaway shadow DB) and applied with `migrate deploy`.
#
# Usage:
#   bash scripts/db-guard.sh check                 # print resolved target, exit 0
#   bash scripts/db-guard.sh assert-local          # fail unless target is local
#   bash scripts/db-guard.sh assert-not-destructive migrate dev
#   source scripts/db-guard.sh                     # use the functions directly

# Commands that must never run against any database in this project.
DESTRUCTIVE_PATTERNS=(
  "migrate dev"
  "migrate reset"
  "db push"
)

# Read the last uncommented assignment of a variable from an env file.
# .env.local intentionally keeps the prod tunnel DSN as commented-out lines, so
# a naive grep would resolve the wrong target.
env_value() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  grep -E "^[[:space:]]*${key}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"'\r' || true
}

# Mirrors prisma.config.ts: .env.local overrides .env, DIRECT_URL wins over DATABASE_URL.
resolve_dsn() {
  local dsn=""
  for key in DIRECT_URL DATABASE_URL; do
    dsn="$(env_value .env.local "$key")"
    [[ -n "$dsn" ]] && { echo "$dsn"; return 0; }
    dsn="$(env_value .env "$key")"
    [[ -n "$dsn" ]] && { echo "$dsn"; return 0; }
  done
  echo ""
}

dsn_target() {
  local dsn="${1:-}"
  [[ -z "$dsn" ]] && { echo "unknown"; return 0; }
  case "$dsn" in
    # Local dev Postgres published by docker-compose.local.yml.
    *127.0.0.1:54322*|*localhost:54322*) echo "local" ;;
    # SSH tunnel to the production Postgres — see the prod-db-local-tunnel note.
    *127.0.0.1:54323*|*localhost:54323*) echo "prod-tunnel" ;;
    *) echo "unknown" ;;
  esac
}

# Strip credentials before anything reaches stdout or a log.
dsn_redacted() {
  echo "${1:-}" | sed -E 's#(://[^:]+:)[^@]*@#\1***@#'
}

assert_not_destructive() {
  local requested="$*"
  for pattern in "${DESTRUCTIVE_PATTERNS[@]}"; do
    if [[ "$requested" == *"$pattern"* ]]; then
      cat >&2 <<EOF
REFUSED: \`prisma ${pattern}\` is banned in this repository.

It reconciles the dev database by dropping what does not match the datamodel.
Against local that destroys the 129 GB TecDoc archive (public.part_vehicle_types
alone is 931M rows) — it exists in no backup and no other environment.

Instead:
  new migration   ->  bun run db:migration:new
  apply to local  ->  bunx prisma migrate deploy
  check drift     ->  bun run db:diff:check
EOF
      return 1
    fi
  done
  return 0
}

assert_local() {
  local dsn target
  dsn="$(resolve_dsn)"
  target="$(dsn_target "$dsn")"
  if [[ "$target" != "local" ]]; then
    echo "REFUSED: expected the local database (127.0.0.1:54322), resolved '${target}': $(dsn_redacted "$dsn")" >&2
    echo "Check the DB target toggle in .env.local." >&2
    return 1
  fi
}

print_target() {
  local dsn target
  dsn="$(resolve_dsn)"
  target="$(dsn_target "$dsn")"
  echo "target : ${target}"
  echo "dsn    : $(dsn_redacted "$dsn")"
  [[ "$target" == "prod-tunnel" ]] && echo "WARNING: this is PRODUCTION via the SSH tunnel." >&2
  [[ "$target" == "unknown" ]] && echo "WARNING: unrecognised host — verify before running anything that writes." >&2
  return 0
}

# Only dispatch when executed directly, so the file stays sourceable.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  case "${1:-check}" in
    check)                 print_target ;;
    assert-local)          assert_local ;;
    assert-not-destructive) shift; assert_not_destructive "$@" ;;
    *) echo "usage: db-guard.sh [check|assert-local|assert-not-destructive <cmd...>]" >&2; exit 2 ;;
  esac
fi
