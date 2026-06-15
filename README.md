# GetirBakim V2

Automotive spare parts e-commerce platform with VIN-based vehicle identification, real-time supplier sync, and multi-brand catalog management.

## Quick Start

**Prerequisites:** [Bun](https://bun.sh) v1.1+

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

```bash
cp .env.example .env.local
# Edit .env.local with your actual credentials
```

**Important — Database connection:**

This project uses Prisma 7 with the `PrismaPg` driver adapter connecting to a self-hosted PostgreSQL instance in Docker:

- Use a local PostgreSQL instance (docker-compose.local.yml includes one)

```
DATABASE_URL="postgresql://postgres:local-dev-postgres-password@127.0.0.1:5432/getirbakim"
DIRECT_URL="postgresql://postgres:local-dev-postgres-password@127.0.0.1:5432/getirbakim"
```

See `.env.example` for the full list of required variables.

### 3. Generate Prisma client

```bash
bun run db:generate
```

### 4. Run development server

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) (or 3001 if 3000 is busy).

## Docker (First-Class Runtime)

This is a Docker-first project. Every release must be validated through Docker.

### Local Docker

```bash
cp .env.example .env          # then fill in credentials
docker compose -f docker-compose.local.yml up -d --build
```

App runs at **http://localhost:3001**

Smoke check: `curl -s http://localhost:3001/api/health`

See [**docs/DOCKER_LOCAL.md**](docs/DOCKER_LOCAL.md) for full local Docker instructions and troubleshooting.

### Production (Contabo VPS)

```bash
git clone <repo> && cd getirbakimv2
cp .env.example .env.production  # then fill in production credentials
# Note: do NOT set NEXT_PUBLIC_BUILD_VERSION in .env.production
# The deploy script injects it automatically from git tags
DOMAIN=https://getirbakim.com bash scripts/vps-deploy.sh
```

See [**docs/DEPLOYMENT_CONTABO.md**](docs/DEPLOYMENT_CONTABO.md) for VPS setup, nginx, SSL, and rollback.

### Environment Variables

See [**docs/ENVIRONMENT.md**](docs/ENVIRONMENT.md) for the full variable reference and secret rotation guidance.

## Automated VPS Deployment

GitHub Actions can deploy to the Contabo VPS via SSH on manual trigger or version tag push. See [**docs/GITHUB_ACTIONS_DEPLOY.md**](docs/GITHUB_ACTIONS_DEPLOY.md) for setup, secrets, and rollback instructions.

## Quality Gates

Before committing or releasing, all must pass:

```bash
bun run lint        # Check: no unsafe SQL + typecheck
bun run typecheck   # TypeScript strict mode
bun run test        # All tests pass
bun run build       # Next.js production build
bun run db:generate # Prisma client up to date
bunx prisma validate # Schema valid
```

## Environment Validation

```bash
bun run env:check:local
bun run env:check:staging
bun run env:check:production
```

## Production Setup

- [Production Secret Management](docs/production-secret-management.md)
- [Auth Production Readiness](docs/AUTH_PRODUCTION.md)
- [Tami Payment Production Readiness](docs/PAYMENT_TAMI_PRODUCTION.md)
- [Production Security Checklist](docs/PRODUCTION_SECURITY_CHECKLIST.md)
- [Operations Runbook](docs/OPERATIONS_RUNBOOK.md)
- [Contabo VPS Deployment](docs/DEPLOYMENT_CONTABO.md)

## Production Go-Live

Before going live, ensure:

1. **Environment**: `bun run env:check:production` passes
2. **Domain**: `NEXT_PUBLIC_SITE_URL=https://getirbakim.com` and `NEXT_PUBLIC_APP_URL=https://getirbakim.com` (no duplicates)
3. **SEO Indexing**: `NEXT_PUBLIC_ALLOW_INDEXING=true` in `.env.production`
4. **SSL**: Certbot installed and `certbot renew --dry-run` passes
5. **Tami**: Production API URLs (`https://paymentapi.tami.com.tr`) set in `.env.production`
6. **Auth**: NextAuth configured with `NEXTAUTH_URL=https://getirbakim.com` and `NEXTAUTH_SECRET` set
7. **Security**: All secrets server-only, security headers verified
8. **Smoke**: `bash scripts/vps-smoke.sh` passes all checks
9. **Rollback**: Previous git tag documented, rollback tested

## Database Architecture

- Prisma 7 with `@prisma/adapter-pg` (pg driver adapter)
- PostgreSQL (self-hosted, `postgres:17-alpine` in Docker) with multi-schema support: `public`, `trodo`, `parcatedarik`
- Connection mode: Direct PrismaPg connections to `postgres:5432` within Docker network (no external pooler)
- Pool size: configurable via `DATABASE_POOL_MAX` / `PG_POOL_MAX`; recommended local Docker value is 2, VPS production value is 4, with an upper clamp of 10