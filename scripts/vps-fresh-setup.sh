#!/usr/bin/env bash
set -euo pipefail

# GetirBakim VPS Fresh Setup Script
# Run as root on a fresh Ubuntu 22.04/24.04 VPS
#
# Prerequisites:
#   - DNS records for getirbakim.com pointing to this VPS IP
#   - Ports 80 and 443 open
#
# Usage:
#   bash vps-fresh-setup.sh
#
# After this script completes:
#   1. Edit .env.production with real production values
#   2. Run: bash scripts/vps-deploy.sh

echo "=========================================="
echo " GetirBakim VPS Fresh Setup"
echo "=========================================="
echo ""

# ── 1. System Update ──────────────────────────────────────────────────────
echo ">>> Updating system packages..."
apt update && apt upgrade -y

# ── 2. Essential Packages ──────────────────────────────────────────────────
echo ">>> Installing essential packages..."
apt install -y curl git ufw certbot python3-certbot-nginx

# ── 3. Docker Installation ────────────────────────────────────────────────
echo ">>> Installing Docker..."
if command -v docker &>/dev/null; then
  echo "  Docker already installed: $(docker --version)"
else
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "  Docker installed: $(docker --version)"
fi

if ! docker compose version &>/dev/null; then
  echo "FATAL: Docker Compose not available"
  exit 1
fi
echo "  Docker Compose: $(docker compose version)"

# ── 4. Create Deploy User ──────────────────────────────────────────────────
echo ">>> Setting up deploy user..."
if id "deploy" &>/dev/null; then
  echo "  User 'deploy' already exists"
else
  adduser --disabled-password --gecos "Deploy User" deploy
  usermod -aG docker deploy
  echo "  User 'deploy' created and added to docker group"
fi

# ── 5. Clone Repository ────────────────────────────────────────────────────
APP_DIR="/opt/getirbakim"
echo ">>> Cloning repository to ${APP_DIR}..."
if [[ -d "${APP_DIR}/.git" ]]; then
  echo "  Repository already exists, pulling latest..."
  cd "${APP_DIR}"
  git fetch origin
  git checkout main
  git reset --hard origin/main
else
  git clone -b main https://github.com/aokcuoglu/getirbakim.git "${APP_DIR}"
  cd "${APP_DIR}"
fi

# ── 6. Stop Old Containers (if any) ───────────────────────────────────────
echo ">>> Removing any old containers..."
docker rm -f getirbakim-app 2>/dev/null || true
docker rm -f getirbakim-nginx 2>/dev/null || true
docker rm -f getirbakim-postgres 2>/dev/null || true
docker rm -f getirbakim-v2-app 2>/dev/null || true

# Remove old docker volumes if starting fresh (WARNING: destroys data)
read -p "Remove old Docker volumes too? (THIS DELETES ALL DATA) [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "  Removing old volumes..."
  docker volume rm postgres_data 2>/dev/null || true
  docker volume rm getirbakim-postgres-data 2>/dev/null || true
  docker compose --env-file .env.production down --remove-orphans -v 2>/dev/null || true
else
  echo "  Keeping existing volumes."
fi

# ── 7. Setup .env.production ───────────────────────────────────────────────
echo ">>> Setting up .env.production..."
if [[ -f ".env.production" ]]; then
  echo "  .env.production already exists."
  echo "  Review and update it with production values:"
  echo "    nano ${APP_DIR}/.env.production"
  echo ""
  echo "  REQUIRED values to set:"
  echo "    POSTGRES_PASSWORD  — strong random password (openssl rand -base64 32)"
  echo "    AUTH_SECRET        — openssl rand -base64 32"
  echo "    NEXT_PUBLIC_SITE_URL — https://getirbakim.com"
  echo "    NEXT_PUBLIC_APP_URL  — https://getirbakim.com"
  echo "    TAMI_*             — production payment keys"
  echo "    DINAMIK_*          — supplier API keys"
  echo "    CRON_SECRET        — openssl rand -hex 32"
else
  echo "  Creating .env.production from .env.example..."
  cp .env.example .env.production
  echo ""
  echo "  *** YOU MUST EDIT .env.production with production values ***"
  echo "    nano ${APP_DIR}/.env.production"
  echo ""
  echo "  After editing, run: bash scripts/vps-deploy.sh"
  echo ""
  echo "  SETUP INCOMPLETE — edit .env.production first, then re-run this script or run deploy manually."
  exit 0
fi

# ── 8. Firewall ────────────────────────────────────────────────────────────
echo ">>> Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "  Firewall configured (SSH, HTTP, HTTPS allowed)"

# ── 9. SSL Certificate ─────────────────────────────────────────────────────
echo ">>> Checking SSL certificate..."
CERT_PATH="/etc/letsencrypt/live/getirbakim.com/fullchain.pem"
if [[ -f "${CERT_PATH}" ]]; then
  echo "  SSL certificate found at ${CERT_PATH}"
else
  echo "  No SSL certificate found."
  echo "  To obtain one after DNS is configured:"
  echo "    sudo certbot certonly --standalone -d getirbakim.com -d www.getirbakim.com"
  echo "  Or use Cloudflare origin certificates."
fi

# ── 10. Backup Cron ────────────────────────────────────────────────────────
echo ">>> Setting up PostgreSQL backup cron..."
mkdir -p /var/backups/postgresql
CRON_LINE="0 3 * * * ${APP_DIR}/scripts/pg-backup.sh >> /var/log/pg-backup.log 2>&1"
if crontab -l 2>/dev/null | grep -q "pg-backup.sh"; then
  echo "  Backup cron already configured"
else
  (crontab -l 2>/dev/null; echo "${CRON_LINE}") | crontab -
  echo "  Backup cron added (daily at 03:00)"
fi

# ── 11. Log Rotation ──────────────────────────────────────────────────────
echo ">>> Setting up log rotation..."
cat > /etc/logrotate.d/getirbakim <<EOF
/var/log/pg-backup.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
}
/var/log/cf-ufw.log {
    weekly
    rotate 4
    compress
    missingok
    notifempty
}
EOF
echo "  Log rotation configured"

# ── 12. First Deploy ───────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo " Setup Complete!"
echo "=========================================="
echo ""
echo "  App directory: ${APP_DIR}"
echo "  Env file:      ${APP_DIR}/.env.production"
echo ""
echo "  NEXT STEPS:"
echo ""
echo "  1. Edit .env.production:"
echo "     nano ${APP_DIR}/.env.production"
echo ""
echo "  2. If using Cloudflare, set SSL to 'Full (strict)'"
echo ""
echo "  3. Run the deploy:"
echo "     cd ${APP_DIR}"
echo "     bash scripts/vps-deploy.sh"
echo ""
echo "  4. Restore database (if migrating from Supabase):"
echo "     gunzip -c /tmp/backup.sql.gz | docker exec -i getirbakim-postgres psql -U postgres -d getirbakim"
echo "     docker exec getirbakim-postgres psql -U postgres -d getirbakim -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'"
echo "     docker exec getirbakim-postgres psql -U postgres -d getirbakim -f /dev/stdin < ${APP_DIR}/scripts/search-indexes.sql"
echo ""
echo "  5. Verify health:"
echo "     curl -sf http://localhost:3000/api/health"
echo ""