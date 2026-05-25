# Docker Local Runtime

GetirBakim V2 runs locally via Docker using `docker-compose.local.yml`.

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

For Docker, also set in `.env` (runtime metadata, health checks, Supabase redirects):

```env
NEXT_PUBLIC_SITE_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3001
```

### Admin panel (`/tr/admin`)

Admin routes require a Supabase session with `users.role = ADMIN` in the database.

- **Log in on port 3001**, not 3000: `bun run dev` uses `:3000`; Docker uses `:3001`. Cookies are not shared between ports.
- If you open `/tr/admin` without a session, you are redirected to `/tr/login?redirect=...` (not the storefront home).
- Set `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` to `http://localhost:3001` in `.env` (see table above).
- Supabase Auth redirect URLs must include `http://localhost:3001/**` if you use OAuth/magic links.

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
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_MEILI_HOST` (default: `http://localhost:7700`)
- `NEXT_PUBLIC_MEILI_SEARCH_KEY`
- `NEXT_PUBLIC_BUILD_VERSION` (default: `dev-local`)
- `NEXT_PUBLIC_ENABLE_COOKIEYES` (default: `false`)
- `NEXT_PUBLIC_COOKIEYES_CLIENT_ID`
- `NEXT_PUBLIC_COOKIEYES_ALLOWED_HOSTS`

Server-side env vars (DATABASE_URL, secrets, etc.) are injected at runtime via `env_file: .env`.

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

### EMAXCONNSESSION / Supabase pool exhaustion

Symptom: Browser shows "Something went wrong". Docker logs show:
```
(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15
```

This means the Supabase session pool (limit 15) is exhausted. Common causes:

- Local Docker and VPS production are both connected to the same Supabase project.
- `DATABASE_POOL_MAX` is set too high.
- Multiple local Docker/Bun dev instances running simultaneously.

**Fix:**

1. Set `DATABASE_POOL_MAX=2` in your local `.env`.
2. Ensure VPS `.env.production` has `DATABASE_POOL_MAX=4` (2 + 4 = 6 < 15).
3. Stop unused local Docker or dev processes:
   ```bash
   docker compose -f docker-compose.local.yml down --remove-orphans
   ```
4. Do NOT switch to transaction pooler port 6543 — PrismaPg requires prepared statements.

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

### Supabase pooler mode errors (P1000 / prepared statement errors)

This project uses Prisma 7 with PrismaPg adapter, which requires **prepared statements**.

Use **session pooler port 5432**:

```
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres"
```

Do **NOT** use transaction pooler port 6543 with `pgbouncer=true` — this disables prepared statements and causes PrismaPg errors.

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