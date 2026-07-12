# Local Development Guide

## Recommended: Hybrid Local Dev (App Outside Docker)

The local development workflow runs the Next.js app **outside Docker** with only
the backing services (Postgres + Meilisearch) in containers. This gives you faster
hot reload, lower battery usage, and better macOS filesystem performance while
keeping production parity intact. It mirrors the bakimx local setup.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  Your Mac                                           │
│                                                     │
│  ┌─────────────────┐    ┌────────────────────────┐  │
│  │  Next.js Dev     │    │  Docker: PostgreSQL     │  │
│  │  (bun run dev)   │───▶│  postgres:17-alpine     │  │
│  │  localhost:3001   │    │  127.0.0.1:54322       │  │
│  │                  │    └────────────────────────┘  │
│  │                  │                                │
│  │                  │    ┌────────────────────────┐  │
│  │                  │───▶│  Docker: Meilisearch     │  │
│  └─────────────────┘    │  127.0.0.1:7700          │  │
│                         └────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Quick Start

```bash
# 1. Start Postgres + Meilisearch in Docker (creates data volumes if needed)
bun run dev:deps

# 2. Wait for services to be healthy (~5 seconds)
docker compose -f docker-compose.local.yml ps

# 3. Start the Next.js dev server (port 3001)
bun run dev

# 4. Verify everything works
curl -s http://localhost:3001/api/health | jq .status
# "ok"

curl -s http://127.0.0.1:7700/health | jq .status
# "available"
```

### Environment Setup

`.env` holds the base config; `.env.local` (gitignored) overrides the host-facing
values for local dev. The committed `.env.local` already contains:

```env
# .env.local — local dev overrides

# Meilisearch: use localhost (not Docker DNS) when app runs outside Docker
MEILI_HOST=http://127.0.0.1:7700
MEILI_MASTER_KEY=...

# App URL for local dev (bun run dev → next dev -p 3001)
NEXT_PUBLIC_SITE_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3001

# Local PostgreSQL published by docker-compose.local.yml (host port 54322)
DATABASE_URL=postgresql://postgres:local-dev-postgres-password@127.0.0.1:54322/getirbakim
DIRECT_URL=postgresql://postgres:local-dev-postgres-password@127.0.0.1:54322/getirbakim
DATABASE_POOL_MAX=15
```

Next.js loads env files in this order (later files override earlier):
1. `.env` (base config)
2. `.env.local` (local overrides — gitignored)
3. `.env.development` / `.env.production` / `.env.test` (Node mode)

### Why This Setup Exists

| Problem | Solution |
|---------|----------|
| Docker rebuilds are slow (minutes) | `bun run dev` = instant hot reload |
| Docker on macOS drains battery | Only Postgres + Meilisearch run in Docker |
| macOS filesystem performance in Docker | App reads/writes on native FS |
| Full Docker stack is overkill for feature work | Two infra containers, app native |

### Meilisearch Setup (First Time Only)

```bash
# Infra already started via `bun run dev:deps`
# Create and configure the search index
bun run search:setup

# (Optional) Full reindex
bun run search:reindex
```

---

## Ports Reference

| Service | Host address | Notes |
|---------|--------------|-------|
| App (`bun run dev`) | http://localhost:3001 | `next dev -p 3001`, runs on the host |
| Postgres | `127.0.0.1:54322` | Container listens on 5432 |
| Meilisearch | `127.0.0.1:7700` | Bound to localhost only |
| Production (VPS) | app :3000 internal | Docker; Nginx proxies :80/:443 |

Production still runs the app in Docker (`docker-compose.yml` on the VPS, built from
`Dockerfile`) — that flow is unchanged. Only local dev moved out of Docker.

---

## Admin Panel (`/tr/admin`)

Admin routes require a NextAuth session with `users.role = ADMIN`.

- Local dev: log in on **http://localhost:3001**.
- If you open `/tr/admin` without a session, you are redirected to `/tr/login?redirect=...`.
- `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` must match the port you use (3001).

---

## Common Issues

### Meilisearch / Postgres connection refused

```
Error: connect ECONNREFUSED 127.0.0.1:7700   (or :54322)
```

Start the infra:
```bash
bun run dev:deps
```

### MEILI_HOST pointing to Docker DNS

If you see `http://meilisearch:7700` in your app logs but the app isn't running in
Docker, confirm `.env.local` has:

```env
MEILI_HOST=http://127.0.0.1:7700
```

### Port 3001 already in use

```bash
lsof -i :3001
# Kill the PID, or start on a different port:
bun run dev -- -p 3002
```

### External volume not found

```
Error: external volume "getirbakim-postgres-data" not found
```

`bun run dev:deps` creates the `getirbakim-postgres-data` and `getirbakim-meili-data`
volumes before starting. Always start infra with that script, not a bare
`docker compose up`.

### Database connection pool exhaustion

Lower the pool in `.env.local`:

```env
DATABASE_POOL_MAX=2
```

### Stopping infra

```bash
bun run dev:deps:stop
```

The `postgres_data_local` and `meili_data_local` volumes are external and persist
across restarts, so your data and search index survive.

---

## npm Scripts Reference

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `next dev -p 3001` | Local Next.js dev server (port 3001) |
| `dev:deps` | `docker compose -f docker-compose.local.yml up -d postgres meilisearch` | Start Postgres + Meilisearch |
| `dev:deps:stop` | `docker compose -f docker-compose.local.yml down` | Stop local infra |
| `search:setup` | `bun scripts/meili-setup.ts` | Create/configure search index |
| `meili:start` | `docker compose -f docker-compose.meili.yml up -d` | Start standalone Meilisearch (alt) |
| `meili:stop` | `docker compose -f docker-compose.meili.yml down` | Stop standalone Meilisearch |
