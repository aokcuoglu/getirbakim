# Local Development Guide

## Recommended: Hybrid Local Dev (App Outside Docker)

The preferred local development workflow runs the Next.js app **outside Docker** with only Meilisearch in a container. This gives you faster hot reload, lower battery usage, and better macOS filesystem performance while keeping production parity intact.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  Your Mac                                           │
│                                                     │
│  ┌─────────────────┐    ┌────────────────────────┐  │
│  │  Next.js Dev     │    │  Docker: PostgreSQL     │  │
│  │  (bun run dev)   │───▶│  postgres:17-alpine     │  │
│  │  localhost:3000   │    │  127.0.0.1:5432        │  │
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
# 1. Start Meilisearch in Docker (also creates the data volume if needed)
bun run meili:start

# 3. Wait for Meilisearch to be healthy (~5 seconds)
docker compose -f docker-compose.meili.yml ps

# 4. Start the Next.js dev server
bun run dev

# 5. Verify everything works
curl -s http://localhost:3000/api/health | jq .status
# "ok"

curl -s http://127.0.0.1:7700/health | jq .status
# "available"
```

### Environment Setup

Create `.env.local` to override Docker-only values for local dev:

```bash
cp .env.example .env        # if .env doesn't exist yet
```

Then create `.env.local` with these overrides:

```env
# .env.local — local dev overrides (gitignored)
# These override values in .env that assume Docker networking.

# Meilisearch: use localhost (not Docker DNS) when app runs outside Docker
MEILI_HOST=http://127.0.0.1:7700
MEILI_MASTER_KEY=local-dev-master-key

# App URL for local dev (port 3000, not 3001)
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Local PostgreSQL published by docker-compose.local.yml
DATABASE_URL=postgresql://postgres:local-dev-postgres-password@127.0.0.1:5432/getirbakim
DIRECT_URL=postgresql://postgres:local-dev-postgres-password@127.0.0.1:5432/getirbakim
DATABASE_POOL_MAX=15
```

Next.js loads env files in this order (later files override earlier):
1. `.env` (base config)
2. `.env.local` (local overrides — gitignored)
3. `.env.development` / `.env.production` / `.env.test` (Node mode)

Your `.env` can keep `MEILI_HOST=http://meilisearch:7700` for Docker mode. `.env.local` overrides it for local dev.

### Verify Meilisearch is Running

```bash
# Check container status
bun run meili:status

# View logs
bun run meili:logs

# Manual health check
curl -s http://127.0.0.1:7700/health
# {"status":"available"}
```

### Why This Setup Exists

| Problem | Solution |
|---------|----------|
| Docker rebuilds are slow (minutes) | `bun run dev` = instant hot reload |
| Docker on macOS drains battery | Only Meilisearch runs in Docker |
| macOS filesystem performance in Docker | App reads/writes on native FS |
| Full Docker stack is overkill for feature work | Meilisearch container = 1 service |

### Meilisearch Setup (First Time Only)

```bash
# Start Meilisearch
bun run meili:start

# Create and configure the search index
bun run search:setup

# (Optional) Full reindex
bun run search:reindex
```

---

## Alternative: Full Docker Local Mode

If you need to test the exact production Docker build locally, use the full Docker stack:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

The app runs at **http://localhost:3001** in this mode.

See [DOCKER_LOCAL.md](./DOCKER_LOCAL.md) for full Docker local documentation.

---

## Ports Reference

| Mode | Next.js | Meilisearch | Notes |
|------|---------|-------------|-------|
| Local dev (`bun run dev`) | :3000 | :7700 (Docker) | **Recommended** |
| Full Docker local | :3001 | :7700 (Docker network) | Production parity testing |
| Production (VPS) | :3000 (internal) | :7700 (internal) | Nginx proxies :80/:443 |

---

## Admin Panel (`/tr/admin`)

Admin routes require a NextAuth session with `users.role = ADMIN`.

- Local dev: use **http://localhost:3000**
- Docker local: use **http://localhost:3001**
- Cookies are NOT shared between ports. Log in on the port you'll use.
- NextAuth `NEXTAUTH_URL` must match the localhost port you're using.

---

## Common Issues

### Meilisearch connection refused

```
Error: connect ECONNREFUSED 127.0.0.1:7700
```

Start Meilisearch:
```bash
bun run meili:start
```

### MEILI_HOST pointing to Docker DNS

If you see `http://meilisearch:7700` in your app logs but the app isn't running in Docker, create/fix your `.env.local`:

```env
MEILI_HOST=http://127.0.0.1:7700
```

### Port 7700 already in use

```bash
lsof -i :7700
# Kill the process or stop Meilisearch
bun run meili:stop
```

### Port 3000 already in use

```bash
lsof -i :3000
# Or start Next.js on a different port:
bun run dev -- -p 3002
```

### Database connection pool exhaustion

Local dev + VPS production both connecting to same PostgreSQL instance? Lower your pool:

```env
# In .env.local
DATABASE_POOL_MAX=2
```

### Switching between local dev and Docker mode

When switching from Docker mode to local dev:

```bash
# Stop full Docker stack
docker compose -f docker-compose.local.yml down

# Start just Meilisearch
bun run meili:start

# Run app locally
bun run dev
```

When switching from local dev to Docker mode:

```bash
# Stop standalone Meilisearch
bun run meili:stop

# Start full Docker stack
docker compose -f docker-compose.local.yml up -d --build
```

Note: Both `docker-compose.meili.yml` and `docker-compose.local.yml` use the same `meili_data_local` volume, so your search index persists across mode switches.

---

## npm Scripts Reference

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `next dev` | Local Next.js dev server |
| `dev:docker` | `docker compose -f docker-compose.local.yml up -d --build` | Full Docker local |
| `meili:start` | `docker compose -f docker-compose.meili.yml up -d` | Start Meilisearch |
| `meili:stop` | `docker compose -f docker-compose.meili.yml down` | Stop Meilisearch |
| `meili:logs` | `docker compose -f docker-compose.meili.yml logs -f` | Tail Meilisearch logs |
| `meili:status` | `docker compose -f docker-compose.meili.yml ps` | Check Meilisearch status |
| `search:setup` | `bun scripts/meili-setup.ts` | Create/configure search index |
| `search:reindex` | `bun scripts/meili-reindex.ts` | Full reindex |
