# Environment Variables

## File Conventions

| File | Purpose | Tracked in Git |
|------|---------|---------------|
| `.env.example` | Reference template with placeholder values | Yes |
| `.env` | Local development / local Docker runtime | No |
| `.env.production` | Production deployment on VPS | No |
| `.env.local` | Personal overrides (not used by Docker) | No |

**Never commit `.env`, `.env.production`, or `.env.local`.**

These are all excluded in `.gitignore`.

## Docker Usage

- Local Docker: `env_file: .env` in `docker-compose.local.yml`
- Production Docker: `env_file: .env.production` in `docker-compose.yml`
- `NEXT_PUBLIC_*` build args are passed separately during `docker compose build`

## Database Connection

This project uses Prisma 7 with the `PrismaPg` driver adapter. The `DATABASE_URL` must point to a local PostgreSQL instance (docker-compose.local.yml provides one).

```
DATABASE_URL="postgresql://postgres:local-dev-postgres-password@127.0.0.1:54322/getirbakim"
DIRECT_URL="postgresql://postgres:local-dev-postgres-password@127.0.0.1:54322/getirbakim"
```

## Variable Reference

### Database

| Variable | Scope | Required | Description |
|----------|-------|----------|-------------|
| `DATABASE_URL` | Server | Yes | PostgreSQL connection string |
| `DIRECT_URL` | Server | Yes | For Prisma migrations and direct queries |
| `DATABASE_POOL_MAX` | Server | No | Max DB pool connections. Local: 15, Production: 4. |

#### `DATABASE_POOL_MAX`

Controls the maximum number of concurrent database connections the PrismaPg adapter opens.

- **Local Docker default:** 15 — Local PostgreSQL has no connection limit concerns.
- **VPS production default:** 4 — Tune based on available resources.

The `PG_POOL_MAX` env var is also accepted as a fallback alias.

### Meilisearch

| Variable | Scope | Required | Description |
|----------|-------|----------|-------------|
| `MEILI_ENABLED` | Server | Yes | Enable/disable Meilisearch integration |
| `MEILI_HOST` | Server | Yes | Internal Meilisearch host URL |
| `MEILI_MASTER_KEY` | Server | Yes | Admin master key — never commit |
| `NEXT_PUBLIC_MEILI_HOST` | Public | Yes | Public Meilisearch host URL |
| `NEXT_PUBLIC_MEILI_SEARCH_KEY` | Public | Yes | Search-only key (safe for browser) |

### Upstash Redis

| Variable | Scope | Required | Description |
|----------|-------|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | Server | Yes | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Server | Yes | REST API token — never commit |
| `UPSTASH_REDIS_KEY_PREFIX` | Server | No | Key prefix for multi-environment sharing |

### Tami Payments

| Variable | Scope | Required | Description |
|----------|-------|----------|-------------|
| `TAMI_MERCHANT_NUMBER` | Server | Yes | Merchant identifier |
| `TAMI_TERMINAL_NUMBER` | Server | Yes | Terminal identifier |
| `TAMI_SECRET_KEY` | Server | Yes | Payment signing secret — never commit |
| `TAMI_JWK_KID` | Server | Yes | JWK key ID for payment signing |
| `TAMI_JWK_K` | Server | Yes | JWK key value for payment signing |
| `TAMI_PAYMENT_API_BASE_URL` | Server | Yes | Sandbox or live API URL |
| `TAMI_PORTAL_BASE_URL` | Server | Yes | Sandbox or live portal URL |

### Dinamik API (Supplier)

| Variable | Scope | Required | Description |
|----------|-------|----------|-------------|
| `DINAMIK_BASE` | Server | Yes | Dinamik API base URL |
| `DINAMIK_APIKEY` | Server | Yes | API key — never commit |
| `DINAMIK_SECRETKEY` | Server | Yes | Secret key — never commit |
| `DINAMIK_PROXY_URL` | Server | No | VPS proxy for IP whitelisting — credentials are sensitive |
| `DINAMIK_PROXY_REQUIRED` | Server | No | `true` (default) or `false` |
| `DINAMIK_BATCH_SIZE` | Server | No | Sync batch size (default: 100) |
| `DINAMIK_BRAND_CONCURRENCY` | Server | No | Brand sync concurrency (default: 4) |
| `DINAMIK_ITEM_CONCURRENCY` | Server | No | Item sync concurrency (default: 25) |
| `DINAMIK_DELTA_SYNC_STALE_MS` | Server | No | Delta sync staleness threshold |

### SETA API (Supplier)

| Variable | Scope | Required | Description |
|----------|-------|----------|-------------|
| `SETA_XAPIKEY` | Server | Yes | SETA API key — never commit |
| `SETA_API_KEY` | Server | Yes | SETA API key — never commit |
| `SETA_APIKEY` | Server | Yes | SETA API key variant — never commit |
| `SETA_SECRETKEY` | Server | Yes | SETA secret key — never commit |
| `SETA_PRODUCTS_URL` | Server | Yes | SETA products endpoint |
| `SETA_ITEM_CONCURRENCY` | Server | No | Item sync concurrency (default: 12) |
| `SUPPLIER_POLICY_CONCURRENCY` | Server | No | Policy sync concurrency (default: 12) |
| `AUTO_MAP_CONCURRENCY` | Server | No | Part number auto-match concurrency (default: 8) |

### Parts2World (Supplier)

| Variable | Scope | Required | Description |
|----------|-------|----------|-------------|
| `PARTS2WORLD_BASE_URL` | Server | No | Parts2World API base URL |
| `PARTS2WORLD_ALLOWED_HOSTS` | Server | No | Comma-separated allowed hosts |
| `PARTS2WORLD_FALLBACK_BASE_URLS` | Server | No | Comma-separated fallback URLs |
| `PARTS2WORLD_CHECKPOINT_DIR` | Server | No | Checkpoint directory (default: `.parts2world-checkpoints`) |

### Google Gemini

| Variable | Scope | Required | Description |
|----------|-------|----------|-------------|
| `GEMINI_API_KEY` | Server | No | Google Generative AI API key (used for AI features if enabled) |

### CookieYes (Cookie Consent)

| Variable | Scope | Required | Description |
|----------|-------|----------|-------------|
| `NEXT_PUBLIC_ENABLE_COOKIEYES` | Public | No | Enable CookieYes widget (`true`/`false`) |
| `NEXT_PUBLIC_COOKIEYES_CLIENT_ID` | Public | No | CookieYes client ID |
| `NEXT_PUBLIC_COOKIEYES_ALLOWED_HOSTS` | Public | No | Comma-separated host list for CookieYes |

### App Metadata

| Variable | Scope | Required | Description |
|----------|-------|----------|-------------|
| `NEXT_PUBLIC_SITE_URL` | Public | No | Canonical site URL |
| `NEXT_PUBLIC_APP_URL` | Public | No | App URL for internal references |
| `NEXT_PUBLIC_BUILD_VERSION` | Public | No | Build/version tag for healthcheck and diagnostics |

### Runtime / Debug

| Variable | Scope | Required | Description |
|----------|-------|----------|-------------|
| `NODE_ENV` | Server | Yes | `development` or `production` |
| `ANALYZE` | Server | No | Enable Next.js bundle analyzer |
| `HIERARCHY_SERVICE_DEBUG` | Server | No | Debug logging for hierarchy service |
| `SLOW_QUERY_THRESHOLD` | Server | No | Log threshold for slow queries in ms (default: 1000) |
| `CRON_SECRET` | Server | Yes | Auth secret for internal scheduled sync routes |

## Server-Only Variables

These must NEVER be exposed to the browser:

- `DATABASE_URL`, `DIRECT_URL`
- `MEILI_MASTER_KEY`
- `UPSTASH_REDIS_REST_TOKEN`
- `TAMI_SECRET_KEY`, `TAMI_JWK_KID`, `TAMI_JWK_K`
- `DINAMIK_APIKEY`, `DINAMIK_SECRETKEY`, `DINAMIK_PROXY_URL`
- `SETA_XAPIKEY`, `SETA_API_KEY`, `SETA_APIKEY`, `SETA_SECRETKEY`
- `CRON_SECRET`
- `GEMINI_API_KEY`

## Public Variables (NEXT_PUBLIC_*)

These are embedded at build time and visible in the browser:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_MEILI_HOST`
- `NEXT_PUBLIC_MEILI_SEARCH_KEY`
- `NEXT_PUBLIC_BUILD_VERSION`
- `NEXT_PUBLIC_ENABLE_COOKIEYES`
- `NEXT_PUBLIC_COOKIEYES_CLIENT_ID`
- `NEXT_PUBLIC_COOKIEYES_ALLOWED_HOSTS`

## Secret Rotation Guidance

If a secret is accidentally committed or exposed:

1. **Immediately rotate** the exposed secret in the provider dashboard.
2. Remove the secret from Git history using `git filter-repo` or equivalent.
3. Update all environments (local `.env`, production `.env.production`) with the new value.
4. Rebuild and redeploy Docker containers if the secret is used at runtime.
5. If the secret is a `NEXT_PUBLIC_*` build arg, you must rebuild the Docker image.
6. Audit access logs for the compromised time window.

See `SECURITY.md` for the full security policy.