# Local Docker Runtime (Infra Only)

> The Next.js app **no longer runs in Docker locally**. `docker-compose.local.yml`
> now provides only the backing services — **Postgres + Meilisearch** — and the
> app runs natively via `bun run dev` on **http://localhost:3001**. This mirrors
> the bakimx local setup (only infra in Docker, app native for fast HMR).
>
> For the full local dev guide see [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md).

## Prerequisites

- [OrbStack](https://orbstack.dev/) or [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- `.env` file in project root (copy from `.env.example`)
- `.env.local` with host-facing overrides (already committed for local dev)

## Quick Start

```bash
# 1. Start Postgres + Meilisearch in Docker (creates the data volumes if missing)
bun run dev:deps

# 2. Start the Next.js dev server (port 3001)
bun run dev

# 3. Verify
curl -s http://localhost:3001/api/health | jq
```

The app runs at **http://localhost:3001**. `database` and `meilisearch` in the
health payload confirm the app reached the dockerized services.

## Ports

| Service | Host address | Notes |
|---------|--------------|--------|
| App (`bun run dev`) | http://localhost:3001 | `next dev -p 3001`, runs on the host (not Docker) |
| Postgres | `127.0.0.1:54322` | Container listens on 5432, published to 54322 |
| Meilisearch | `127.0.0.1:7700` | Bound to localhost only |

`.env.local` already points the host-side app at these:

```env
DATABASE_URL=postgresql://postgres:local-dev-postgres-password@127.0.0.1:54322/getirbakim
DIRECT_URL=postgresql://postgres:local-dev-postgres-password@127.0.0.1:54322/getirbakim
MEILI_HOST=http://127.0.0.1:7700
NEXT_PUBLIC_SITE_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3001
```

### Admin panel (`/tr/admin`)

Admin routes require an admin session with `users.role = ADMIN` in the database.
Log in on **http://localhost:3001**. If you open `/tr/admin` without a session,
you are redirected to `/tr/login?redirect=...`.

## Commands

| Action | Command |
|--------|---------|
| Start infra (postgres + meili) | `bun run dev:deps` |
| Stop infra | `bun run dev:deps:stop` |
| Start app | `bun run dev` |
| Infra logs | `docker compose -f docker-compose.local.yml logs -f` |
| Infra status | `docker compose -f docker-compose.local.yml ps` |
| Postgres shell | `docker exec -it getirbakim-postgres-local psql -U postgres -d getirbakim` |

## Healthcheck

```bash
curl -s http://localhost:3001/api/health | jq
```

Expected:

```json
{
  "status": "ok",
  "checks": { "database": "ok", "meilisearch": "ok (available)", "siteUrl": "http://localhost:3001" }
}
```

If `database` is `"error"`, confirm `bun run dev:deps` is up and `DATABASE_URL`
in `.env.local` points at `127.0.0.1:54322`.

### Dinamik API (proxy zorunlu)

Dinamik, yalnızca whitelist’teki VPS IP’sinden istek kabul eder. Yerel `bun run dev`
ortamında admin API testleri **doğrudan internete değil**, VPS Squid proxy’sine
gitmelidir. `.env` içine ekleyin (Postman’de kullandığınız kullanıcı/şifre/port ile aynı):

```env
DINAMIK_BASE=https://dinamikapp-api.dinamik.online
DINAMIK_APIKEY=...
DINAMIK_SECRETKEY=...
DINAMIK_PROXY_URL=http://dinamik:your-password@173.249.36.2:8888
DINAMIK_PROXY_REQUIRED=true
```

Admin panelde `/admin/suppliers/dinamik` üzerinde **Proxy 173.249.36.2:8888** rozeti
görünmeli. Squid `acl` satırında Mac’inizin güncel public IP’si (`curl -4 ifconfig.me`)
tanımlı olmalı.

## Common Issues

### OrbStack / Docker Desktop not running

```
Cannot connect to the Docker daemon
```

Start OrbStack or Docker Desktop and retry `bun run dev:deps`.

### Port 3001 occupied

```
Error: listen EADDRINUSE :::3001
```

```bash
lsof -i :3001
kill <PID>
```

Or change the port in the `dev` script (`next dev -p <port>`).

### External volume not found

```
Error: external volume "getirbakim-postgres-data" not found
```

`bun run dev:deps` creates the `getirbakim-postgres-data` and
`getirbakim-meili-data` volumes before starting. Run it (not a bare
`docker compose up`) so the volumes exist.

### PrismaPg prepared statement errors

Symptom: `P1000: PostgreSQL error: prepared statement "s0" does not exist`

Fix: Use the session pooler (port 5432 inside the container / 54322 on host), which
`.env.local` already targets.

## Production Docker

Production still runs the app in Docker via `docker-compose.yml` on the VPS (built
from `Dockerfile`). That flow is unchanged — this document only covers local infra.
