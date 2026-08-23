#!/usr/bin/env bash
set -euo pipefail

# GetirBakim VPS Setup Script
# Run this on a fresh Ubuntu 22.04/24.04 VPS to set up the production environment.
#
# Usage:
#   bash infra/scripts/vps-setup.sh
#
# This script:
#   1. Installs Docker and Docker Compose
#   2. Creates deploy user (if not exists)
#   3. Clones the repository
#   4. Sets up .env.production from template
#   5. Configures firewall (UFW)
#   6. Requests SSL certificate (Let's Encrypt)
#   7. Sets up PostgreSQL backup cron
#   8. Runs initial deploy
#
# Prerequisites:
#   - Root or sudo access
#   - Domain DNS pointed to this VPS
#   - Ports 80 and 443 open

APP_DIR="${APP_DIR:-/opt/getirbakim}"
REPO_URL="${REPO_URL:-https://github.com/aokcuoglu/getirbakim.git}"
BRANCH="${BRANCH:-main}"
DOMAIN="${DOMAIN:-getirbakim.com}"

echo "=== GetirBakim VPS Setup ==="
echo "App dir: ${APP_DIR}"
echo "Repo:    ${REPO_URL}"
echo "Branch:  ${BRANCH}"
echo "Domain:  ${DOMAIN}"
echo ""

# ── 1. System Updates ─────────────────────────────────────────────────────
echo ">>> Updating system packages..."
apt update && apt upgrade -y

# ── 2. Install Docker ─────────────────────────────────────────────────────
echo ">>> Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "  Docker installed: $(docker --version)"
else
  echo "  Docker already installed: $(docker --version)"
fi

if ! command -v docker &>/dev/null || ! docker compose version &>/dev/null; then
  echo "FATAL: Docker or Docker Compose not available after installation"
  exit 1
fi

# ── 3. Create deploy user ─────────────────────────────────────────────────
echo ">>> Setting up deploy user..."
if id "deploy" &>/dev/null; then
  echo "  User 'deploy' already exists"
else
  adduser --disabled-password --gecos "Deploy User" deploy
  usermod -aG docker deploy
  echo "  User 'deploy' created and added to docker group"
fi

# ── 4. Clone repository ───────────────────────────────────────────────────
echo ">>> Cloning repository..."
if [[ -d "${APP_DIR}/.git" ]]; then
  echo "  Repository already exists at ${APP_DIR}"
  cd "${APP_DIR}"
  git fetch origin || true
  git checkout "${BRANCH}"
  git reset --hard "origin/${BRANCH}" 2>/dev/null || true
else
  git clone -b "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
  cd "${APP_DIR}"
fi

# ── 5. Create .env.production ─────────────────────────────────────────────
echo ">>> Setting up .env.production..."
if [[ -f ".env.production" ]]; then
  echo "  .env.production already exists — backing up to .env.production.bak"
  cp .env.production .env.production.bak
fi

if [[ ! -f ".env.production" ]]; then
  echo "  Creating .env.production from .env.example..."
  cp .env.example .env.production
  echo ""
  echo "  IMPORTANT: Edit .env.production with production values:"
  echo "    nano ${APP_DIR}/.env.production"
  echo ""
  echo "  Required values to set:"
  echo "    POSTGRES_PASSWORD  — strong random password"
  echo "    AUTH_SECRET        — openssl rand -base64 32"
  echo "    TAMI_*             — production payment keys"
  echo "    DINAMIK_*          — supplier API keys"
  echo "    NEXT_PUBLIC_SITE_URL — https://${DOMAIN}"
  echo "    NEXT_PUBLIC_APP_URL  — https://${DOMAIN}"
  echo ""
  echo "  Run this script again after editing .env.production, or run:"
  echo "    bash scripts/vps-deploy.sh"
  exit 0
fi

# ── 6. Firewall ────────────────────────────────────────────────────────────
echo ">>> Configuring firewall (UFW)..."
if command -v ufw &>/dev/null; then
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp    # SSH
  ufw allow 80/tcp    # HTTP
  ufw allow 443/tcp   # HTTPS
  ufw --force enable
  echo "  Firewall configured (SSH, HTTP, HTTPS allowed)"
else
  echo "  ufw not available — skipping firewall setup"
fi

# ── 7. SSL Certificate ────────────────────────────────────────────────────
echo ">>> Checking SSL certificate..."
CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
if [[ -f "${CERT_PATH}" ]]; then
  echo "  SSL certificate found at ${CERT_PATH}"
else
  echo "  No SSL certificate found."
  echo "  To obtain one, run:"
  echo "    sudo apt install -y certbot python3-certbot-nginx"
  echo "    sudo certbot certonly --standalone -d ${DOMAIN} -d www.${DOMAIN}"
  echo ""
  echo "  Or use Cloudflare origin certificates."
fi

# ── 8. PostgreSQL Backup Cron ─────────────────────────────────────────────
echo ">>> Setting up PostgreSQL backup cron..."
mkdir -p /var/backups/postgresql
CRON_LINE="0 3 * * * ${APP_DIR}/scripts/pg-backup.sh >> /var/log/pg-backup.log 2>&1"
if crontab -l 2>/dev/null | grep -q "pg-backup.sh"; then
  echo "  Backup cron already configured"
else
  (crontab -l 2>/dev/null; echo "${CRON_LINE}") | crontab -
  echo "  Backup cron added (daily at 03:00)"
fi

# ── 9. Log Rotation ───────────────────────────────────────────────────────
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

# ── 10. Initial Deploy ─────────────────────────────────────────────────────
echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env.production:"
echo "     nano ${APP_DIR}/.env.production"
echo ""
echo "  2. If using Cloudflare, set SSL to 'Full (strict)'"
echo ""
echo "  3. Run the deploy script:"
echo "     cd ${APP_DIR}"
echo "     bash scripts/vps-deploy.sh"
echo ""
echo "  4. Verify health:"
echo "     curl -sf http://localhost:3000/api/health"
echo ""