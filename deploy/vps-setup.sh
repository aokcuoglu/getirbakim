#!/bin/bash
set -euo pipefail

# =============================================================================
# VPS Setup Script for getirbakim
# Run this once on a fresh Contabo VPS as root
# Usage: bash vps-setup.sh <DOMAIN> <GITHUB_USER>
# =============================================================================

DOMAIN="${1:?Usage: bash vps-setup.sh <DOMAIN> <GITHUB_USER>}"
GITHUB_USER="${2:?Usage: bash vps-setup.sh <DOMAIN> <GITHUB_USER>}"
APP_DIR="/opt/getirbakim"

echo "=== Updating system ==="
apt update && apt upgrade -y

echo "=== Installing Docker ==="
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi

echo "=== Installing Docker Compose plugin ==="
apt install -y docker-compose-plugin

echo "=== Creating deploy user ==="
if ! id "deploy" &>/dev/null; then
    useradd -m -s /bin/bash -G docker deploy
    mkdir -p /home/deploy/.ssh
    chmod 700 /home/deploy/.ssh
    touch /home/deploy/.ssh/authorized_keys
    chmod 600 /home/deploy/.ssh/authorized_keys
    chown -R deploy:deploy /home/deploy/.ssh
    echo ">>> Add your GitHub Actions SSH public key to /home/deploy/.ssh/authorized_keys"
fi

echo "=== Creating app directory ==="
mkdir -p "${APP_DIR}/nginx/conf.d"
chown -R deploy:deploy "${APP_DIR}"

echo "=== Configuring firewall ==="
apt install -y ufw
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "=== Creating .env.production template ==="
if [ ! -f "${APP_DIR}/.env.production" ]; then
    cat > "${APP_DIR}/.env.production" << 'ENVEOF'
# Database
DATABASE_URL=
DIRECT_URL=

# Auth
AUTH_SECRET=

# App URLs
NEXT_PUBLIC_SITE_URL=
NEXT_PUBLIC_APP_URL=

# Cron
CRON_SECRET=

# Suppliers
DINAMIK_BASE=
DINAMIK_APIKEY=
DINAMIK_SECRETKEY=
SETA_XAPIKEY=

# Meilisearch
MEILI_HOST=
MEILI_MASTER_KEY=
NEXT_PUBLIC_MEILI_HOST=
NEXT_PUBLIC_MEILI_SEARCH_KEY=

# Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Payments
TAMI_MERCHANT_NUMBER=
TAMI_TERMINAL_NUMBER=
TAMI_SECRET_KEY=

# Add remaining env vars from .env.example
ENVEOF
    echo ">>> Edit ${APP_DIR}/.env.production with your actual values"
fi

echo "=== Copying docker-compose and nginx config ==="
echo ">>> You need to copy these files to ${APP_DIR}:"
echo "    - docker-compose.yml"
echo "    - nginx/conf.d/default.conf"
echo ""
echo "    Run from your local machine:"
echo "    scp docker-compose.yml deploy@<VPS_IP>:${APP_DIR}/"
echo "    scp -r nginx deploy@<VPS_IP>:${APP_DIR}/"

echo ""
echo "=== SSL Setup Instructions ==="
echo "After copying files and updating nginx config with your domain:"
echo ""
echo "1. Update nginx/conf.d/default.conf — replace DOMAIN with: ${DOMAIN}"
echo ""
echo "2. First, start nginx with HTTP-only (comment out the SSL server block):"
echo "   cd ${APP_DIR} && docker compose up -d nginx"
echo ""
echo "3. Get initial SSL certificate:"
echo "   docker compose run --rm certbot certonly --webroot -w /var/www/certbot -d ${DOMAIN}"
echo ""
echo "4. Uncomment the SSL server block in nginx config, then:"
echo "   docker compose restart nginx"
echo ""
echo "5. Start the certbot auto-renewal container:"
echo "   docker compose up -d certbot"

echo ""
echo "=== Setting up cron jobs ==="
CRON_SCRIPT="${APP_DIR}/cron-sync.sh"
cat > "${CRON_SCRIPT}" << 'CRONEOF'
#!/bin/bash
source /opt/getirbakim/.env.production
curl -sf -H "Authorization: Bearer ${CRON_SECRET}" "$1" >> /var/log/getirbakim-cron.log 2>&1
CRONEOF
chmod +x "${CRON_SCRIPT}"
chown deploy:deploy "${CRON_SCRIPT}"

# Install crontab for deploy user
CRON_TMP=$(mktemp)
cat > "${CRON_TMP}" << EOF
# getirbakim supplier sync
0 2 * * 1-6 ${CRON_SCRIPT} "http://localhost:3000/api/internal/suppliers/dinamik/sync"
0 3 * * 0   ${CRON_SCRIPT} "http://localhost:3000/api/internal/suppliers/dinamik/sync"
30 2 * * 1-6 ${CRON_SCRIPT} "http://localhost:3000/api/internal/suppliers/seta/sync?mode=delta"
30 3 * * 0   ${CRON_SCRIPT} "http://localhost:3000/api/internal/suppliers/seta/sync?mode=full"
EOF
crontab -u deploy "${CRON_TMP}"
rm "${CRON_TMP}"

echo ""
echo "=== Setting up log rotation ==="
cat > /etc/logrotate.d/getirbakim << EOF
/var/log/getirbakim-cron.log {
    weekly
    rotate 4
    compress
    missingok
    notifempty
}
EOF

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "1. Add GitHub Actions SSH public key to /home/deploy/.ssh/authorized_keys"
echo "2. Copy docker-compose.yml and nginx config to ${APP_DIR}"
echo "3. Edit ${APP_DIR}/.env.production with real values"
echo "4. Update nginx config: replace DOMAIN with ${DOMAIN}"
echo "5. Follow SSL setup instructions above"
echo "6. Set GitHub repo secrets: VPS_HOST, VPS_USER (deploy), VPS_SSH_KEY"
echo "7. Set GitHub repo variables: all NEXT_PUBLIC_* values"
echo "8. Push to main branch to trigger first deploy"
