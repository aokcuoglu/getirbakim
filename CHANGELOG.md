# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.5] - 2026-05-07

### Changed
- `docker-compose.yml`: removed stale `image: ghcr.io/aokcuoglu/getirbakim-v2:latest`; changed `NEXT_PUBLIC_BUILD_VERSION` default from `v0.1.3` to `dev`; updated comments to document local build strategy and version injection
- `docker-compose.local.yml`: updated comments to remove GHCR image reference
- `.github/workflows/deploy-vps.yml`: added `version` input to `workflow_dispatch`; added version determination step (input > tag > short SHA); passes `NEXT_PUBLIC_BUILD_VERSION` to deploy script
- `scripts/vps-deploy.sh`: computes `DEPLOY_VERSION` from `NEXT_PUBLIC_BUILD_VERSION` > `GITHUB_REF_NAME` > `VERSION` > git tag > short SHA > "dev"; exports `NEXT_PUBLIC_BUILD_VERSION` and passes it to `docker compose up --build`; reports health check version; increased startup wait to 20s
- `docs/GITHUB_ACTIONS_DEPLOY.md`: documented version inference, manual version input, updated security checklist
- `docs/DEPLOYMENT_CONTABO.md`: removed `NEXT_PUBLIC_BUILD_VERSION` from `.env.production` settings; added version injection docs; updated deploy/rollback commands
- `docs/OPERATIONS_RUNBOOK.md`: updated version in health response example; added version source explanation; updated all commands to include `NEXT_PUBLIC_BUILD_VERSION`
- `README.md`: updated production deploy instructions to use deploy script

### Fixed
- `/api/health` version now reflects the actual deployed release (not a stale hardcoded value from `.env.production`)
- Production VPS compose no longer references stale GHCR image
- Deploy version consistency: GitHub Actions and deploy script agree on version

## [0.1.4] - 2026-05-07

### Added
- `.github/workflows/deploy-vps.yml` — controlled SSH-based VPS deployment workflow (manual trigger + v* tag push)
- `docs/GITHUB_ACTIONS_DEPLOY.md` — GitHub Actions deploy documentation (SSH key setup, GitHub Secrets, rollback, security)
- GitHub Actions failure troubleshooting section in `docs/OPERATIONS_RUNBOOK.md`
- GitHub Secrets checklist in `docs/PRODUCTION_SECURITY_CHECKLIST.md`

### Changed
- `scripts/vps-deploy.sh` — accepts `PROJECT_PATH`, `BRANCH`, `DOMAIN` env vars; verifies `.env.production` exists; 15s startup wait; fails on health check; shows before/after commit; no secret printing
- `scripts/vps-smoke.sh` — accepts `DOMAIN` env var or argument; checks internal + public endpoints; 10s curl timeout; exits non-zero on failure
- `scripts/vps-rollback.sh` — accepts `ROLLBACK_REF` env var; fetches origin tags; validates ref; verifies `.env.production`; fails with logs on health check; saves rollback point
- Replaced `.github/workflows/deploy.yml` (GHCR auto-deploy) with `.github/workflows/deploy-vps.yml` (SSH controlled deploy)
- `docs/OPERATIONS_RUNBOOK.md` — added GitHub Actions deploy, script env var usage, rollback env var, failure troubleshooting
- `docs/PRODUCTION_SECURITY_CHECKLIST.md` — added GitHub Secrets section, deploy workflow security, root user warning
- `README.md` — added Automated VPS Deployment section

## [0.1.3] - 2026-05-05

### Hardened
- Secret hygiene release guard: added `scripts/secret-scan.sh` for pre-commit/pre-release scanning (tracked files, staged diffs, gitignore verification) without broad recursive grep
- Hardened `.gitignore`: added `!.env.*.example`, `*.env.bak`, `*.env.backup`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`; removed duplicate `*.pem` entry
- Hardened `.dockerignore`: explicit `.env`/`.env.*`/`!.env.example` exclusions, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`
- Removed `.env.bak-*` and `.env.production` from repository root (backed up externally)
- Updated `docs/PRODUCTION_SECURITY_CHECKLIST.md` with secret hygiene policy
- SEO indexing control: added `NEXT_PUBLIC_ALLOW_INDEXING` env variable; robots.txt, sitemap, and metadata respect this flag
- `scripts/vps-deploy.sh`: improved with repo validation, git HEAD display, container logs, longer wait, structured output
- `scripts/vps-smoke.sh`: accepts `DOMAIN` parameter, uses `set -euo pipefail`

### Added
- `NEXT_PUBLIC_ALLOW_INDEXING` env variable and `isIndexingAllowed()` in `lib/site-url.ts`
- `scripts/vps-rollback.sh` — git tag-based rollback with health check
- `docs/AUTH_PRODUCTION.md` — Supabase auth production checklist
- `docs/PAYMENT_TAMI_PRODUCTION.md` — Tami payment production checklist
- `docs/PRODUCTION_SECURITY_CHECKLIST.md` — admin access, secrets, headers, rate limiting
- `docs/OPERATIONS_RUNBOOK.md` — healthcheck, logs, deploy, rollback, common failures
- Production Go-Live section in README with pre-launch checklist
- SSL/HTTPS verification and security header checks in `docs/DEPLOYMENT_CONTABO.md`

### Changed
- `app/robots.ts`: respects `NEXT_PUBLIC_ALLOW_INDEXING` flag
- `app/[locale]/layout.tsx`: adds noindex metadata when indexing disabled
- `app/sitemap.xml/route.ts`: returns empty sitemap with noindex when indexing disabled
- `app/[locale]/sitemap.xml/route.ts`: returns empty sitemap with noindex when indexing disabled
- `scripts/validate-env.ts`: warns if `NEXT_PUBLIC_ALLOW_INDEXING` is not `true` in production
- `.env.example`: added `NEXT_PUBLIC_ALLOW_INDEXING`
- `lib/db.ts`: PrismaPg pool size is now env-configurable via `DATABASE_POOL_MAX` / `PG_POOL_MAX` (replaces hardcoded `max: 10`)

### Fixed
- Local Docker Supabase session pool exhaustion: PrismaPg pool size is now configurable to prevent `EMAXCONNSESSION` when local Docker and VPS production share the same Supabase project

## [0.1.2] - 2026-05-05

### Added
- `docs/nginx/getirbakim.conf.example` — example nginx reverse proxy configuration with SSL, gzip, and caching headers
- `scripts/vps-deploy.sh` — VPS deployment script (git pull, rebuild, health check)
- `scripts/vps-smoke.sh` — VPS smoke test script (internal + external HTTP/HTTPS checks)

### Changed
- `docker-compose.yml`: updated default `NEXT_PUBLIC_BUILD_VERSION` to `v0.1.2`, updated GHCR image name to `ghcr.io/aokcuoglu/getirbakim-v2:latest`
- `docs/DEPLOYMENT_CONTABO.md`: updated git clone URL, directory references, and version references

### Infrastructure
- Clean Contabo VPS reinstall and provisioning verified
- Docker Engine and Docker Compose installed and verified
- Repository cloned via GitHub read-only deploy key
- `.env.production` kept only on VPS
- Docker container running and healthy on `http://127.0.0.1:3000`
- nginx HTTP reverse proxy configured and working on `http://getirbakim.com`
- `/api/health`, `/tr`, `/en` verified through nginx
- HTTPS/SSL: pending (to be configured in future release)
- GitHub push/tag/release does not auto-update VPS; manual deploy required

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