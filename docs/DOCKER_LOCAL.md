# Docker Local Runtime

> **For the recommended local development workflow (app outside Docker, only Meilisearch in Docker), see [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md).**
>
> This document covers the **full Docker local mode** for production parity testing.

GetirBakim V2 can run locally via Docker using `docker-compose.local.yml`.

## Prerequisites

- [OrbStack](https://orbstack.dev/) or [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- `.env` file in project root (copy from `.env.example`)

## Quick Start

```bash
# 1. Create .env if missing
cp .env.example .env
# Edit .env with your credentials

# 2. Build and run
docker compose -f docker-compose.local.yml up -d --build

# 3. Verify
curl -s http://localhost:3001/api/health
```

The app runs at **http://localhost:3001**.

### Ports (3000 vs 3001)

| Mode | Host URL | Notes |
|------|----------|--------|
| `bun run dev` | http://localhost:3000 | Default Next dev server |
| `docker-compose.local.yml` | http://localhost:3001 | Host **and** container listen on **3001** (`127.0.0.1:3001:3001`) |

`docker-compose.local.yml` **hardcodes** `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` to `http://localhost:3001` at image build time so a `.env` still pointing at `:3000` does not break auth or redirects in Docker.

For Docker, also set in `.env` (runtime metadata, health checks):

```env
NEXT_PUBLIC_SITE_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3001
```

### Admin panel (`/tr/admin`)

Admin routes require an admin session (Stack Auth) with `users.role = ADMIN` in the database.

- **Log in on port 3001**, not 3000: `bun run dev` uses `:3000`; Docker uses `:3001`. Cookies are not shared between ports.
- If you open `/tr/admin` without a session, you are redirected to `/tr/login?redirect=...` (not the storefront home).
- Set `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` to `http://localhost:3001` in `.env` (see table above).

## Commands

| Action | Command |
|--------|---------|
| Build & start | `docker compose -f docker-compose.local.yml up -d --build` |
| Stop | `docker compose -f docker-compose.local.yml down` |
| Stop & remove orphans | `docker compose -f docker-compose.local.yml down --remove-orphans` |
| Rebuild (no cache) | `docker compose -f docker-compose.local.yml build --no-cache` |
| View logs | `docker compose -f docker-compose.local.yml logs app --tail=100 -f` |
| Check status | `docker compose -f docker-compose.local.yml ps` |
| Restart | `docker compose -f docker-compose.local.yml restart` |
| Shell into container | `docker exec -it getirbakim-app-local sh` |

## Healthcheck

The container includes a built-in healthcheck hitting `/api/health` every 30 seconds.

Manual smoke:

```bash
curl -s http://localhost:3001/api/health | jq
```

Expected response:

```json
{
  "status": "ok",
  "version": "dev-local",
  "checks": { "database": "ok" },
  "runtimeMs": 5,
  "timestamp": "2026-05-04T..."
}
```

If `database` is `"error"`, check `DATABASE_URL` in your `.env`.

## Build Arguments

The local compose passes these `NEXT_PUBLIC_*` build args from your `.env`:

- `NEXT_PUBLIC_SITE_URL` (default: `http://localhost:3001`)
- `NEXT_PUBLIC_APP_URL` (default: `http://localhost:3001`)
- `NEXT_PUBLIC_MEILI_HOST` (default: `http://localhost:7700`)
- `NEXT_PUBLIC_MEILI_SEARCH_KEY`
- `NEXT_PUBLIC_BUILD_VERSION` (default: `dev-local`)
- `NEXT_PUBLIC_ENABLE_COOKIEYES` (default: `false`)
- `NEXT_PUBLIC_COOKIEYES_CLIENT_ID`
- `NEXT_PUBLIC_COOKIEYES_ALLOWED_HOSTS`

Server-side secrets are injected at runtime via `env_file: .env`. For database access,
`docker-compose.local.yml` overrides `DATABASE_URL` and `DIRECT_URL` so the app always
uses the local `getirbakim` PostgreSQL service at `postgres:5432`.

The same compose file provides a local PostgreSQL database. For `bun run dev` and Prisma commands running on the host, use `.env.local`:

```env
DATABASE_URL=postgresql://postgres:local-dev-postgres-password@127.0.0.1:54322/getirbakim
DIRECT_URL=postgresql://postgres:local-dev-postgres-password@127.0.0.1:54322/getirbakim
```

### Dinamik API (proxy zorunlu)

Dinamik, yalnızca whitelist’teki VPS IP’sinden istek kabul eder. Yerel Docker veya `bun run dev` ortamında admin API testleri **doğrudan internete değil**, VPS Squid proxy’sine gitmelidir.

`.env` içine ekleyin (Postman’de kullandığınız kullanıcı/şifre/port ile aynı):

```env
DINAMIK_BASE=https://dinamikapp-api.dinamik.online
DINAMIK_APIKEY=...
DINAMIK_SECRETKEY=...
DINAMIK_PROXY_URL=http://dinamik:your-password@173.249.36.2:8888
DINAMIK_PROXY_REQUIRED=true
```

Değişiklikten sonra:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

Admin panelde `/admin/suppliers/dinamik` üzerinde **Proxy 173.249.36.2:8888** rozeti görünmeli. Squid `acl` satırında Mac’inizin güncel public IP’si (`curl -4 ifconfig.me`) tanımlı olmalı.

## Common Issues

### OrbStack / Docker Desktop not running

```
Cannot connect to the Docker daemon
```

Start OrbStack or Docker Desktop and retry.

### Port 3001 occupied

```
Error: Bind for 127.0.0.1:3001 failed: port is already allocated
```

Find and stop the process:

```bash
lsof -i :3001
kill <PID>
```

Or change the port in `docker-compose.local.yml`.

### .env missing

```
ERROR: env_file .env not found
```

Copy from `.env.example` and fill in values:

```bash
cp .env.example .env
```

### PrismaPg prepared statement errors

Symptom: `P1000: PostgreSQL error: prepared statement "s0" does not exist`

Fix: Switch `DATABASE_URL` to session pooler (port 5432). See above.

### Container exits immediately

```bash
docker compose -f docker-compose.local.yml logs app --tail=50
```

Common causes:
- Missing required env var
- Invalid `DATABASE_URL`
- Build failed (re-run with `--build`)

### Build fails with missing NEXT_PUBLIC_ vars

The build requires `NEXT_PUBLIC_*` vars as build args. Ensure they exist in your `.env` or accept the defaults in the compose file.
