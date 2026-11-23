#!/usr/bin/env bash
# Registers (or removes) the owner's Mac as the self-hosted GitHub Actions runner for CI (#1047).
#   scripts/ci/mac-runner-setup.sh           install: download, register, start as a launchd service
#   scripts/ci/mac-runner-setup.sh remove    stop, uninstall the service and unregister the runner
# A second instance on the same Mac (parallel jobs): RUNNER_DIR=~/actions-runner-getirbakim-2 RUNNER_NAME=<name>-2 ...
# Only for a PRIVATE repository: on a public one a fork pull request can point runs-on at this Mac.
# The runner lives in its own directory (RUNNER_DIR, default ~/actions-runner-getirbakim) and never touches the
# dev server on :3000 or the local database; CI starts its own Postgres container on a free port.
# Guide: docs/ci-mac-runner.md
set -euo pipefail

REPO="${REPO:-aokcuoglu/getirbakim}"
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner-getirbakim}"
RUNNER_NAME="${RUNNER_NAME:-$(scutil --get LocalHostName)-getirbakim}"
RUNNER_VERSION="2.338.2"
RUNNER_SHA256="25a065af409ffa317ab4d5a3b614dd15fc9c40f2172bc1b35a1b1258e919a388"
ARCHIVE="actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz"

fail() { echo "error: $*" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || fail "this script is for an Apple Silicon Mac"
command -v gh >/dev/null || fail "gh (GitHub CLI) is required"
gh auth status >/dev/null 2>&1 || fail "gh is not signed in (gh auth login)"

remove() {
  [ -f "$RUNNER_DIR/.runner" ] || fail "no runner configured in $RUNNER_DIR"
  cd "$RUNNER_DIR"
  ./svc.sh stop || true
  ./svc.sh uninstall || true
  token="$(gh api -X POST "repos/$REPO/actions/runners/remove-token" --jq .token)"
  ./config.sh remove --token "$token"
  echo "Runner removed. Unset CI_RUNS_ON if it still points here: gh variable delete CI_RUNS_ON -R $REPO"
}

install() {
  [ "$(gh api "repos/$REPO" --jq .private)" = true ] || fail "$REPO is public; register the runner only after it is private"
  docker info >/dev/null 2>&1 || fail "Docker Desktop must be running (CI starts Postgres with docker run)"
  [ ! -f "$RUNNER_DIR/.runner" ] || fail "a runner is already configured in $RUNNER_DIR (remove it first)"

  mkdir -p "$RUNNER_DIR"
  cd "$RUNNER_DIR"
  if [ ! -f "$ARCHIVE" ]; then
    curl -fsSL -o "$ARCHIVE" "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${ARCHIVE}"
  fi
  echo "${RUNNER_SHA256}  ${ARCHIVE}" | shasum -a 256 -c -
  tar xzf "$ARCHIVE"

  # Short-lived (one hour) token; it is not stored anywhere.
  token="$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)"
  # self-hosted, macOS and ARM64 are the runner's default labels; getirbakim is added.
  ./config.sh --unattended --url "https://github.com/$REPO" --token "$token" \
    --name "$RUNNER_NAME" --labels getirbakim --work _work

  # launchd user agent; it keeps the PATH of this shell (.path), so docker and git must be on it now.
  ./svc.sh install
  ./svc.sh start
  ./svc.sh status
  cat <<EOF

Runner "$RUNNER_NAME" is registered. Move CI to it with:
  gh variable set CI_RUNS_ON -R $REPO --body '["self-hosted","macOS","ARM64","getirbakim"]'
EOF
}

case "${1:-install}" in
  install) install ;;
  remove) remove ;;
  *) fail "usage: $0 [install|remove]" ;;
esac
