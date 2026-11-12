#!/usr/bin/env bash
# Deploy / (re)load the neutral edge reverse proxy.
#
# Idempotent and safe to re-run. Validates the nginx config in a throwaway
# container BEFORE touching the live one, so a bad config can never take the
# edge (and thus every site on the VPS) down.
#
# Usage:  bash deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

echo ">>> Ensuring shared 'edge' network exists..."
if ! docker network inspect edge >/dev/null 2>&1; then
  docker network create edge
  echo "  created network: edge"
else
  echo "  network 'edge' already present"
fi

echo ">>> Validating nginx config (throwaway container)..."
# Real certs are mounted so `nginx -t` actually loads them, catching cert-path
# mistakes that a certless test would miss.
docker pull nginx:stable-alpine >/dev/null 2>&1 || true
if ! docker run --rm \
  -v "$PWD/conf.d/getirbakim.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$PWD/conf.d/bakimx.conf:/etc/nginx/conf.d/10-bakimx.conf:ro" \
  -v /etc/letsencrypt:/etc/letsencrypt:ro \
  -v /var/www/certbot:/var/www/certbot:ro \
  nginx:stable-alpine nginx -t; then
  echo "FATAL: nginx config invalid — aborting, live edge left untouched."
  exit 1
fi

echo ">>> Freeing ports 80/443 from any legacy binder..."
# Host nginx (pre-Docker era) would collide on 80/443.
systemctl stop nginx 2>/dev/null || true
# A legacy per-app edge container (the old getirbakim-owned nginx) must be gone
# before this one can bind. Remove it if present — its config now lives here.
docker rm -f getirbakim-nginx 2>/dev/null || true

echo ">>> Bringing up edge-nginx..."
docker compose up -d

echo ">>> Waiting for health..."
for i in $(seq 1 30); do
  status=$(docker inspect --format='{{.State.Health.Status}}' edge-nginx 2>/dev/null || echo "unknown")
  if [[ "$status" == "healthy" ]]; then
    echo "  edge-nginx: healthy"
    break
  fi
  if [[ "$i" == "30" ]]; then
    echo "WARNING: edge-nginx not healthy after 30 tries (status=$status)"
    docker logs edge-nginx --tail=40 2>&1 || true
  fi
  sleep 1
done

echo ">>> Done. Routing:"
echo "    getirbakim.com                -> getirbakim-app:3000"
echo "    bakimx.com / app.bakimx.com   -> bakimx-app:3000"
echo "    staging.app.bakimx.com        -> bakimx-staging-app:3000"
echo ""
echo "NOTE: apps must be attached to the 'edge' network with their aliases."
echo "      Reload after a config edit:  docker exec edge-nginx nginx -s reload"
