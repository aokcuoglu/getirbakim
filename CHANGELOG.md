# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.1] - 2026-05-04

### Hardened
- `docker-compose.local.yml`: added CookieYes build args, `NODE_ENV=production`, healthcheck points to `/api/health`, `start_period: 40s`, fixed default URLs to `localhost:3001`
- `docker-compose.yml`: added local build strategy alongside GHCR image, `NODE_ENV=production`, healthcheck points to `/api/health`, `start_period: 40s`
- `/api/health` endpoint: removed rate limiting (Docker healthcheck must always pass), added `version` field

### Added
- `docs/DOCKER_LOCAL.md` — local Docker runtime guide
- `docs/DEPLOYMENT_CONTABO.md` — Contabo VPS deployment guide (server setup, nginx, SSL, rollback, backup)
- `docs/ENVIRONMENT.md` — environment variable reference with Supabase pooler requirements and secret rotation guidance

### Changed
- README.md Docker section rewritten as Docker-first with links to new docs

## [0.1.0] - 2026-05-04

### Fixed
- Prisma/Supabase database connection: switched from transaction pooler (port 6543, pgbouncer=true) to session pooler (port 5432) for PrismaPg adapter compatibility
- PrismaPg pool size reduced to 10 to stay within Supabase session pool limit
- Added SSL configuration (`rejectUnauthorized: false`) for Supabase connections
- TypeScript error: added `autoMatchOrCreatePartAfterOemSave` stub returning `{ matched: false }` in `lib/actions/admin-suppliers.ts`
- TypeScript error: narrowed Prisma `string` to `DinamikJob['status']` and `DinamikJob['mode']` in `lib/suppliers/dinamik-job-queue.ts`
- Test: corrected `toVatIncludedDecimal` expectations from 23% to 20% VAT rate in `lib/orders/types.test.ts`
- Test: mocked `@/lib/suppliers/dinamik-catalog-seed` in catalog-seed route test to avoid `server-only` import error

### Added
- `docker-compose.local.yml` for local Docker builds
- Comprehensive `.env.example` with Supabase session pooler documentation
- `RELEASE_NOTES.md` and `CHANGELOG.md`

### Changed
- `.gitignore` now excludes `.env.*` (except `.env.example`) and `.env.bak-*`
- `NODE_ENV` in local `.env` set to `development`