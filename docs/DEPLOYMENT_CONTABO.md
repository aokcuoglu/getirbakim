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
- `NEXT_PUBLIC_SITE_URL` — `https://getirbakim.com`
- `NEXT_PUBLIC_APP_URL` — `https://getirbakim.com`
- `NEXT_PUBLIC_BUILD_VERSION` — `v0.1.2`
- All supplier API keys and secrets
- `NODE_ENV=production`

### Choose deployment strategy

#### Strategy A: Local build on VPS (recommended)

```bash
docker compose build
docker compose up -d
```

Advantages:
- No GHCR authentication needed
- Full control over build
- Simpler workflow

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

```bash
cd getirbakim-v2
git pull origin main
docker compose build
docker compose up -d
```

Zero-downtime is not guaranteed with a single container. For zero-downtime, add a second app instance and use nginx load balancing.

## 9. Rollback

```bash
# 1. Find the previous image
docker images | grep getirbakim-v2

# 2. Tag and run the previous version
docker tag <previous-image-id> ghcr.io/aokcuoglu/getirbakim-v2:latest
docker compose up -d

# Or via git:
git checkout v0.1.0
docker compose build
docker compose up -d
```

## 10. Backup / Environment Strategy

- **`.env.production`** is the single source of truth for production config.
- Keep a backup of `.env.production` in a secure location (not in the repo).
- Document all env var changes in `docs/ENVIRONMENT.md`.
- Use git tags for release tracking: `git tag v0.1.2`.
- Database backups are managed by Supabase — verify their backup schedule.

## 11. Firewall

```bash
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw enable
```

Do NOT expose port 3000 externally. The app binds to `127.0.0.1:3000` in production compose.