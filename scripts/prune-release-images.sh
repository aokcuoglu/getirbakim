#!/usr/bin/env bash
set -euo pipefail
[[ "${BUILD_VERSION:-}" =~ ^[0-9a-f]{12}$ ]] || exit 2
for repository in "$@"; do
  case "$repository" in
    getirbakim-v2-production-app|getirbakim-v2-production-operations|getirbakim-v2-app|getirbakim-v2-operations) ;;
    *) echo 'Unexpected release repository.' >&2; exit 2 ;;
  esac
  previous=0
  while IFS= read -r tag; do
    [[ "$tag" == "$repository:$BUILD_VERSION" || "$tag" == *':<none>' ]] && continue
    previous=$((previous+1))
    [[ "$previous" -le 1 ]] && continue
    if [[ "${DRY_RUN:-0}" == 1 ]]; then echo "$tag"; continue; fi
    # Docker refuses to remove an image used by a container; never force removal.
    docker image rm "$tag" >/dev/null || true
  done < <(docker image ls "$repository" --format '{{.Repository}}:{{.Tag}}')
done
