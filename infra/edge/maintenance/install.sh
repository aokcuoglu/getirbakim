#!/bin/bash
# Installs getirbakim.com maintenance mode on the VPS edge nginx. Does NOT turn it on.
# Run from the repo on your Mac:  bash infra/edge/maintenance/install.sh
# Needs the SSH alias getirbakim-prod (root@173.249.36.2, ~/.ssh/vps_deploy_key).
set -euo pipefail
W=$(cd "$(dirname "$0")" && pwd)   # infra/edge/maintenance
CONF="$W/../conf.d/getirbakim.conf"
H=getirbakim-prod
scp -q "$CONF" "$H:/root/getirbakim.conf.new"
scp -q "$W/index.html" "$H:/root/maintenance-index.html"
scp -q "$W/getirbakim-maintenance.sh" "$H:/opt/edge/getirbakim-maintenance.sh"
ssh -n "$H" 'set -e
cd /opt/edge
TS=$(date -u +%Y%m%dT%H%M%S); cp -p conf.d/getirbakim.conf conf.d/getirbakim.conf.bak.pre-maintenance.$TS
install -d -m 755 /var/www/certbot/getirbakim-maintenance
install -m 644 /root/maintenance-index.html /var/www/certbot/getirbakim-maintenance/index.html
chmod 755 /opt/edge/getirbakim-maintenance.sh
docker exec edge-nginx test -f /var/www/certbot/getirbakim-maintenance/index.html && echo "page visible in edge-nginx"
# In place (same inode): the single-file bind mount keeps seeing the file.
cat /root/getirbakim.conf.new > conf.d/getirbakim.conf
if docker exec edge-nginx nginx -t 2>&1 | grep -q "test is successful"; then
  docker exec edge-nginx nginx -s reload && echo "nginx -t OK, reloaded"
else
  docker exec edge-nginx nginx -t 2>&1 | tail -3
  cat conf.d/getirbakim.conf.bak.pre-maintenance.$TS > conf.d/getirbakim.conf
  echo "FAILED: previous config restored"; exit 1
fi
rm -f /root/getirbakim.conf.new /root/maintenance-index.html
sleep 2; bash /opt/edge/getirbakim-maintenance.sh status'
echo "public: getirbakim.com $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://getirbakim.com/)  bakimx.com $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://bakimx.com/)"
