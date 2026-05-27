# Cloudflare Origin Lockdown — GetirBakim V2

**Last updated:** 2026-05-27
**Goal:** Only Cloudflare IP ranges can access the origin server on port 443.

---

## Why Origin Lockdown?

When Cloudflare proxies your traffic (orange cloud), all requests appear to come from Cloudflare IPs, not the real visitor. Without origin lockdown, attackers can:

1. **Bypass Cloudflare WAF/Rate Limiting** — by sending requests directly to your origin IP
2. **DDoS your origin** — circumventing CF's DDoS protection
3. **Find your origin IP** — via DNS history, certificate transparency logs, or brute force

Origin lockdown ensures Cloudflare is the ONLY entry point. Any request that doesn't go through Cloudflare is blocked at the firewall level.

---

## Step 1: Install and Configure UFW

On Contabo VPS:

```bash
# Install UFW if not already present
sudo apt update
sudo apt install ufw -y

# Reset to clean state (WARNING: this clears all rules)
sudo ufw --force reset

# Default policies: deny incoming, allow outgoing
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH (critical — don't lock yourself out!)
sudo ufw allow ssh
# OR: sudo ufw allow 22/tcp

# Enable UFW
sudo ufw enable

# Verify
sudo ufw status verbose
```

---

## Step 2: Allow Cloudflare IP Ranges Only

Cloudflare publishes their IP ranges at:
- IPv4: https://www.cloudflare.com/ips-v4/
- IPv6: https://www.cloudflare.com/ips-v6/

### Automated Script

Save this script as `/opt/cf-ufw.sh`:

```bash
#!/bin/bash
# Cloudflare UFW lockdown script for GetirBakim V2
# Restricts ports 80/443 to Cloudflare IP ranges only.
# Run periodically (cron) to pick up new Cloudflare IPs.

set -euo pipefail

CF_IPS_V4_URL="https://www.cloudflare.com/ips-v4/"
CF_IPS_V6_URL="https://www.cloudflare.com/ips-v6/"

# Remove old Cloudflare rules (if any)
echo ">>> Removing existing Cloudflare UFW rules..."
ufw status numbered | grep -E '80|443' | awk -F'[][]' '{print $2}' | sort -rn | while read -r num; do
    echo "y" | ufw --force delete "$num" 2>/dev/null || true
done

# For a clean approach, use UFW application profiles or custom rules.
# Since UFW doesn't natively support "from ANY to ANY" with a list,
# we add each Cloudflare IP range individually.

echo ">>> Fetching Cloudflare IPv4 ranges..."
curl -sS "$CF_IPS_V4_URL" | while read -r ip; do
    [ -z "$ip" ] && continue
    sudo ufw allow proto tcp from "$ip" to any port 80,443 comment "Cloudflare IPv4"
done

echo ">>> Fetching Cloudflare IPv6 ranges..."
curl -sS "$CF_IPS_V6_URL" | while read -r ip; do
    [ -z "$ip" ] && continue
    sudo ufw allow proto tcp from "$ip" to any port 80,443 comment "Cloudflare IPv6"
done

echo ">>> Reloading UFW..."
sudo ufw reload

echo ">>> Current UFW status:"
sudo ufw status numbered

echo ""
echo "Cloudflare origin lockdown applied successfully."
```

Make executable:
```bash
chmod +x /opt/cf-ufw.sh
```

### Run Once

```bash
sudo bash /opt/cf-ufw.sh
```

### Schedule Auto-Update (Monthly)

Cloudflare occasionally adds/removes IP ranges. Schedule a monthly update:

```bash
# Add to root crontab
sudo crontab -e

# Add line:
0 3 1 * * /opt/cf-ufw.sh > /var/log/cf-ufw.log 2>&1
```

---

## Step 3: Verify Lockdown

```bash
# From VPS (should work — localhost bypasses UFW):
curl -s http://127.0.0.1:80
curl -sk https://127.0.0.1:443

# From your machine (NOT through Cloudflare):
# Try accessing the VPS IP directly:
curl -I --connect-timeout 5 http://<VPS_IP>:80
# Should time out or connection refused

# Through Cloudflare (should work):
curl -I https://getirbakim.com
# Should return 200 OK

# Test Cloudflare IP is allowed:
# Get a Cloudflare IP (e.g., from https://www.cloudflare.com/ips-v4/)
# From another server or VPS with that IP:
curl -I --resolve getirbakim.com:443:<CF_IP> https://getirbakim.com/
# Should work through resolved CF IP
```

---

## Step 4: Emergency Access

If you need direct access to the origin (bypass Cloudflare), you have options:

### Option A: Temporarily Allow Your IP

```bash
# Allow your current IP
sudo ufw allow proto tcp from <YOUR_IP> to any port 443

# Test directly
curl -H "Host: getirbakim.com" https://<VPS_IP>/

# Remove when done
sudo ufw delete allow proto tcp from <YOUR_IP> to any port 443
```

### Option B: Use the `direct` Subdomain

If you configured `direct.getirbakim.com` (DNS-only, gray cloud in CF):

```bash
# Allow your IP permanently
sudo ufw allow proto tcp from <YOUR_IP> to any port 443 comment "Admin direct access"
```

### Option C: SSH Tunnel (Safest)

```bash
# Forward local port 8443 to VPS port 443 via SSH
ssh -L 8443:127.0.0.1:443 <user>@<VPS_IP>

# Access locally
curl -k https://localhost:8443/ -H "Host: getirbakim.com"
```

---

## Step 5: Firewall State (Production Baseline)

After lockdown, your UFW should look like:

```
Status: active

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere
80,443/tcp                 ALLOW       173.245.48.0/20         # Cloudflare IPv4
80,443/tcp                 ALLOW       103.21.244.0/22         # Cloudflare IPv4
80,443/tcp                 ALLOW       103.22.200.0/22         # Cloudflare IPv4
... (all Cloudflare IP ranges)
80,443/tcp                 ALLOW       2400:cb00::/32          # Cloudflare IPv6
... (all Cloudflare IPv6 ranges)
22/tcp (v6)                ALLOW       Anywhere (v6)
```

---

## Complementary Security Measures

### 1. Docker Network Isolation

Our Docker Compose already ensures:
- Only nginx binds to host ports 80/443
- App and Meilisearch are on internal Docker network only
- No direct access to app or Meilisearch from outside Docker

### 2. Nginx `deny all` for Internal Routes

The nginx config blocks `/api/internal/*` at the reverse proxy level:
```nginx
location /api/internal/ {
    deny all;
    return 403;
}
```

### 3. Cloudflare Authenticated Origin Pulls (Optional)

For the highest security, configure Cloudflare Authenticated Origin Pulls:
1. Cloudflare Dashboard → SSL/TLS → Origin Server
2. Enable "Authenticated Origin Pulls"
3. Download the origin certificate
4. Add to nginx:
```nginx
ssl_client_certificate /etc/nginx/certs/cloudflare.crt;
ssl_verify_client on;
```

This ensures the origin ONLY accepts connections that come through Cloudflare's edge, even if someone spoofs a Cloudflare IP.

### 4. Certificate Transparency Monitoring

Monitor new certificates issued for your domain:
- https://crt.sh/?q=%.getirbakim.com
- Set up alerts for unexpected certificates

---

## Risks and Considerations

| Risk | Mitigation |
|------|-----------|
| Cloudflare adds new IP ranges | Monthly cron job updates UFW rules |
| Cloudflare downtime | Emergency access procedure (Section 4) |
| UFW not running after reboot | `sudo systemctl enable ufw` |
| IPv6 not considered | Both IPv4 and IPv6 ranges included in script |

---

## Validation

```bash
# Check UFW is enabled and running
sudo ufw status verbose

# Verify Cloudflare IPs are allowed
sudo ufw status | grep Cloudflare | wc -l
# Should show ~30+ rules (IPv4 + IPv6)

# Verify direct access is blocked
curl --connect-timeout 5 http://<VPS_IP>:80
# Should fail with "Connection timed out" or "Connection refused"

# Verify CF-proxied access works
curl -I https://getirbakim.com
# Should return HTTP/2 200
```

---

**Origin lockdown complete.** The origin server now only accepts traffic via Cloudflare.
