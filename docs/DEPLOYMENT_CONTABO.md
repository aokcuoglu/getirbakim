# Contabo VPS Deployment

Guide for deploying GetirBakim V2 to a Contabo VPS using Docker Compose behind nginx with SSL.

## VPS Assumptions

- Contabo VPS (Cloud VPS 1 or higher recommended)
- Ubuntu 22.04 or 24.04 LTS
- At least 2 vCPU, 4 GB RAM
- 50 GB+ SSD storage
- Public IP with ports 80 and 443 open

## 1. Server Setup

### Update system

```bash
sudo apt update && sudo apt upgrade -y
```

### Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

Verify:

```bash
docker --version
docker compose version
```

### Install nginx

```bash
sudo apt install -y nginx
```

### Install Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
```

## 2. Deploy the Application

### Clone the repository

```bash
git clone https://github.com/aokcuoglu/getirbakim-v2.git
cd getirbakim-v2
```

### Create production environment

```bash
cp .env.example .env.production
```

Edit `.env.production` with production values:

```bash
nano .env.production
```

**Critical settings:**

- `DATABASE_URL` — Supabase session pooler (port 5432, NOT 6543)
- `DATABASE_POOL_MAX` — `4` (VPS production recommended; local Docker should use `2`)
- `NEXT_PUBLIC_SITE_URL` — `https://getirbakim.com`
- `NEXT_PUBLIC_APP_URL` — `https://getirbakim.com`
- All supplier API keys and secrets
- `NODE_ENV=production`

**Do NOT set `NEXT_PUBLIC_BUILD_VERSION` in `.env.production`.** The deploy script (`scripts/vps-deploy.sh`) and GitHub Actions workflow inject this at build time. `/api/health` reports the version that was baked into the Docker build.

If you must run `docker compose` manually without the deploy script, pass the version explicitly:

```bash
NEXT_PUBLIC_BUILD_VERSION=v0.1.5 docker compose --env-file .env.production up -d --build
```

If local Docker is also running against the same Supabase project, ensure
`DATABASE_POOL_MAX` across both runtimes sums to less than 15 (the Supabase
session pool limit). Recommended: VPS `4` + local `2` = 6 < 15.

### Choose deployment strategy

#### Strategy A: Local build on VPS (recommended)

The VPS clones the repo and builds from the Dockerfile. The deploy script injects the build version:

```bash
bash scripts/vps-deploy.sh
```

Or manually with explicit version:

```bash
NEXT_PUBLIC_BUILD_VERSION=v0.1.5 docker compose --env-file .env.production build
NEXT_PUBLIC_BUILD_VERSION=v0.1.5 docker compose --env-file .env.production up -d
```

Advantages:
- No GHCR authentication needed
- Full control over build
- Simpler workflow
- Build version is always explicit and traceable

#### Strategy B: GHCR private image pull

```bash
echo <GHCR_PAT> | docker login ghcr.io -u <username> --password-stdin
docker compose pull
docker compose up -d
```

Remove the `build:` section from `docker-compose.yml` if only using pre-built images.

### Verify

```bash
docker compose ps
curl -s http://localhost:3000/api/health | jq
```

## 3. Configure nginx Reverse Proxy

Create `/etc/nginx/sites-available/getirbakim.com`:

```nginx
upstream nextjs_app {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name getirbakim.com www.getirbakim.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    http2 on;
    server_name getirbakim.com www.getirbakim.com;

    ssl_certificate /etc/letsencrypt/live/getirbakim.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/getirbakim.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    client_max_body_size 50M;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_min_length 256;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml application/wasm font/woff2;

    location /_next/static/ {
        proxy_pass http://nextjs_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location /_next/image {
        proxy_pass http://nextjs_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        add_header Cache-Control "public, max-age=86400, stale-while-revalidate=604800";
    }

    location / {
        proxy_pass http://nextjs_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/getirbakim.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 4. SSL / HTTPS

### Option A: Let's Encrypt with Certbot

```bash
sudo mkdir -p /var/www/certbot
sudo certbot --nginx -d getirbakim.com -d www.getirbakim.com
```

Certbot will auto-renew. Verify:

```bash
sudo certbot renew --dry-run
```

### Option B: Cloudflare SSL

1. Point DNS to VPS IP via Cloudflare.
2. Set SSL mode to "Full (strict)".
3. Use Cloudflare origin certificate or Let's Encrypt.
4. Cloudflare handles edge SSL automatically.

## 5. Restart Policy

The production compose uses `restart: unless-stopped`. This means:

- Container restarts automatically on crash or server reboot.
- Container does NOT restart after `docker compose stop`.
- Container DOES restart after Docker daemon restart or server reboot.

## 6. Logs

```bash
docker compose logs app --tail=100 -f
docker compose logs app --since 1h
```

## 7. Healthcheck

The container includes a healthcheck hitting `/api/health`:

```bash
curl -s http://localhost:3000/api/health | jq
```

You can also check container health directly:

```bash
docker inspect --format='{{.State.Health.Status}}' getirbakim-app
```

## 8. Update / Redeploy

### Via deploy script (recommended)

```bash
cd /opt/getirbakim-v2
DOMAIN=https://getirbakim.com bash scripts/vps-deploy.sh
```

The deploy script automatically derives the version from git tags or accepts `NEXT_PUBLIC_BUILD_VERSION` env var.

### Via GitHub Actions

Go to **GitHub → Actions → Deploy VPS → Run workflow**. Optionally specify a version string.

### Manual deploy

```bash
cd /opt/getirbakim-v2
git pull origin main
NEXT_PUBLIC_BUILD_VERSION=v0.1.5 docker compose --env-file .env.production down --remove-orphans
NEXT_PUBLIC_BUILD_VERSION=v0.1.5 docker compose --env-file .env.production up -d --build
```

Zero-downtime is not guaranteed with a single container. For zero-downtime, add a second app instance and use nginx load balancing.

## 9. Rollback

```bash
cd /opt/getirbakim-v2
git tag -l
git checkout v0.1.0
NEXT_PUBLIC_BUILD_VERSION=v0.1.0 docker compose --env-file .env.production down --remove-orphans
NEXT_PUBLIC_BUILD_VERSION=v0.1.0 docker compose --env-file .env.production up -d --build
```

## 10. Backup / Environment Strategy

- **`.env.production`** is the single source of truth for production config (secrets, URLs, keys).
- **`NEXT_PUBLIC_BUILD_VERSION`** should NOT be in `.env.production`. It is injected by the deploy script or GitHub Actions at build time.
- Keep a backup of `.env.production` in a secure location (not in the repo).
- Document all env var changes in `docs/ENVIRONMENT.md`.
- Use git tags for release tracking: `git tag v0.1.5`.
- Database backups are managed by Supabase — verify their backup schedule.

## 11. Firewall

```bash
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw enable
```

Do NOT expose port 3000 externally. The app binds to `127.0.0.1:3000` in production compose.

## 12. HTTPS / SSL Verification

After initial SSL setup, verify:

```bash
# Test nginx configuration
sudo nginx -t

# Verify SSL certificate
sudo certbot certificates

# Dry-run renewal
sudo certbot renew --dry-run

# Reload nginx after cert changes
sudo systemctl reload nginx
```

### Smoke Tests for HTTPS

```bash
# Homepage
curl -sI https://getirbakim.com | head -1
# Expected: HTTP/2 200

# Health endpoint
curl -s https://getirbakim.com/api/health | jq
# Expected: {"status":"ok","version":"v0.1.5",...}

# Turkish locale
curl -sI https://getirbakim.com/tr | head -1
# Expected: HTTP/2 200

# English locale
curl -sI https://getirbakim.com/en | head -1
# Expected: HTTP/2 200

# www redirect (should 301 or serve same content)
curl -sI https://www.getirbakim.com | head -1

# HTTP redirect to HTTPS
curl -sI http://getirbakim.com | head -1
# Expected: 301 redirect to https://getirbakim.com/
```

### SSL Renewal

Certbot auto-renews certs. Verify the cron timer:
```bash
sudo systemctl list-timers | grep certbot
```

Manual renewal:
```bash
sudo certbot renew --nginx -d getirbakim.com -d www.getirbakim.com
sudo systemctl reload nginx
```

## 13. Monitoring

- Application health: `curl -sf http://127.0.0.1:3000/api/health`
- Container status: `docker compose ps`
- Container health: `docker inspect --format='{{.State.Health.Status}}' getirbakim-app`
- Nginx error log: `sudo tail -50 /var/log/nginx/getirbakim.com.error.log`
- App log: `docker compose logs app --tail=100`
- See **docs/OPERATIONS_RUNBOOK.md** for full operational procedures

## 14. Security Headers Verification

Verify security headers are present:
```bash
curl -sI https://getirbakim.com | grep -iE 'strict-transport|x-content-type|x-frame|content-security|referrer-policy|permissions-policy'
```

Expected headers:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy: default-src 'self'; ...`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()`