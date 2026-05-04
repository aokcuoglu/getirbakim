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

This project uses Prisma 7 with the `PrismaPg` driver adapter. The DATABASE_URL must use **Supabase session pooler** settings:

- Use **port 5432** (session mode) — supports prepared statements required by PrismaPg
- **Do NOT use** port 6543 with `?pgbouncer=true` — transaction mode is incompatible with PrismaPg

```
# Correct:
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres"

# Incorrect (will cause P1000 or prepared statement errors):
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true"
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

## Docker

### Local build

```bash
docker compose -f docker-compose.local.yml up -d --build
```

App runs at http://localhost:3001

### Production image

The production `docker-compose.yml` uses a private GHCR image (`ghcr.io/aokcuoglu/zupv2:latest`) which requires authentication:

```bash
docker login ghcr.io -u <username> -p <token>
docker compose up -d
```

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

## Database Architecture

- Prisma 7 with `@prisma/adapter-pg` (pg driver adapter)
- PostgreSQL via Supabase with multi-schema support: `public`, `trodo`, `parcatedarik`
- Connection mode: Supabase IPv4 session pooler (port 5432)
- Pool size: 10 connections (within Supabase free tier limit of 15)