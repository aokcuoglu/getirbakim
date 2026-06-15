#!/usr/bin/env bash
# Cloudflare Origin Lockdown — UFW firewall for GetirBakim V2
#
# Purpose:
#   Restricts ingress on ports 80/443 to Cloudflare IP ranges ONLY.
#   All other traffic to these ports is denied by default UFW policy.
#   SSH (port 22) is preserved — do NOT lock yourself out.
#
# Usage:
#   sudo bash infra/scripts/cf-ufw-lockdown.sh
#
# Maintenance:
#   Run monthly via cron to pick up new Cloudflare IP ranges.
#   Cloudflare publishes current ranges at:
#     https://www.cloudflare.com/ips-v4/
#     https://www.cloudflare.com/ips-v6/
#
# Cron (monthly, 1st day at 3 AM):
#   0 3 1 * * bash /opt/getirbakim/infra/scripts/cf-ufw-lockdown.sh >> /var/log/cf-ufw.log 2>&1

set -euo pipefail

CF_IPS_V4_URL="https://www.cloudflare.com/ips-v4/"
CF_IPS_V6_URL="https://www.cloudflare.com/ips-v6/"
RULE_COMMENT="Cloudflare-origin-lockdown"

echo "=== Cloudflare Origin Lockdown $(date) ==="
echo ""

# ── Prerequisites ────────────────────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
    echo "ERROR: This script must be run as root (sudo)."
    exit 1
fi

if ! command -v ufw &>/dev/null; then
    echo ">>> Installing UFW..."
    apt-get update -qq && apt-get install -y -qq ufw
fi

# ── Initialize UFW (idempotent) ─────────────────────────────────────────────

echo ">>> Ensuring UFW is enabled with safe defaults..."
ufw --force default deny incoming
ufw --force default allow outgoing

# Always allow SSH — critical for VPS access
if ! ufw status | grep -q "22/tcp.*ALLOW"; then
    ufw allow 22/tcp comment "SSH"
fi
ufw --force enable

# ── Remove old Cloudflare rules (idempotent re-run) ───────────────────────

echo ">>> Removing existing Cloudflare UFW rules..."
EXISTING=$(ufw status numbered | grep "${RULE_COMMENT}" | awk -F'[][]' '{print $2}' | sort -rn || true)
if [[ -n "${EXISTING}" ]]; then
    for num in ${EXISTING}; do
        echo "y" | ufw --force delete "$num" 2>/dev/null || true
    done
fi

# ── Allow Cloudflare IPv4 ranges ────────────────────────────────────────────

echo ">>> Fetching Cloudflare IPv4 ranges..."
IPV4_COUNT=0
curl -sSf "${CF_IPS_V4_URL}" | while read -r cidr; do
    [[ -z "${cidr}" ]] && continue
    ufw allow proto tcp from "${cidr}" to any port 80,443 comment "${RULE_COMMENT}" 2>/dev/null
    IPV4_COUNT=$((IPV4_COUNT + 1))
done
echo "   Allowed IPv4 ranges: $(curl -sSf "${CF_IPS_V4_URL}" | wc -l | tr -d ' ')"

# ── Allow Cloudflare IPv6 ranges ────────────────────────────────────────────

echo ">>> Fetching Cloudflare IPv6 ranges..."
curl -sSf "${CF_IPS_V6_URL}" | while read -r cidr; do
    [[ -z "${cidr}" ]] && continue
    ufw allow proto tcp from "${cidr}" to any port 80,443 comment "${RULE_COMMENT}" 2>/dev/null
done
echo "   Allowed IPv6 ranges: $(curl -sSf "${CF_IPS_V6_URL}" | wc -l | tr -d ' ')"

# ── Reload and verify ────────────────────────────────────────────────────────

echo ">>> Reloading UFW..."
ufw reload

echo ""
echo ">>> UFW Status:"
ufw status numbered

echo ""
echo ">>> Cloudflare rules count:"
ufw status | grep -c "${RULE_COMMENT}" || echo "0"

echo ""
echo "=== Lockdown applied successfully ==="
echo "Origin ports 80/443 now restricted to Cloudflare IP ranges only."
echo "SSH (22) preserved for direct VPS access."
