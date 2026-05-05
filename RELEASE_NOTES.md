# Release Notes

## v0.1.3 - Production Go-Live Hardening

### Production Domain and Canonical Hardening
- Hardcoded `https://www.getirbakim.com` URL fallbacks in `lib/supabase/storage.ts` and `lib/actions/category-actions.ts` replaced with `resolveSiteUrl()` calls
- `lib/site-url.ts` now exports `isIndexingAllowed()` for SEO indexing control
- `.env.example` updated with `NEXT_PUBLIC_ALLOW_INDEXING` variable

### SEO Indexing Control
- Added `NEXT_PUBLIC_ALLOW_INDEXING` env variable (set `true` in production to allow search engine indexing)
- `app/robots.ts` now respects `NEXT_PUBLIC_ALLOW_INDEXING`: disallows indexing when not `true`
- `app/[locale]/layout.tsx` adds `robots: { index: false, follow: false }` metadata when indexing is disabled
- `app/sitemap.xml/route.ts` returns empty sitemap with `X-Robots-Tag: noindex` when indexing is disabled
- `app/[locale]/sitemap.xml/route.ts` returns empty sitemap with `X-Robots-Tag: noindex` when indexing is disabled
- `scripts/validate-env.ts` now warns if `NEXT_PUBLIC_ALLOW_INDEXING` is not `true` in production

### Auth Production Readiness
- Reviewed auth routes, callback, middleware, login/signup flows
- Added `docs/AUTH_PRODUCTION.md` with Supabase dashboard settings, redirect URL checklist, server-only key warnings, and test checklist

### Tami Payment Production Readiness
- Reviewed payment callback, service, security hash verification, amount mismatch handling
- Added `docs/PAYMENT_TAMI_PRODUCTION.md` with production callback URL, env variables, sandbox vs production URLs, amount mismatch expectations, production switch checklist

### Admin and Operational Security
- Reviewed admin route protection, middleware, server-side auth, API admin endpoints
- Added `docs/PRODUCTION_SECURITY_CHECKLIST.md` with admin access, secret handling, env configuration, security headers, payment endpoint protection, supplier endpoint protection, rate limiting recommendations

### VPS Deploy Script Hardening
- `scripts/vps-deploy.sh`: improved with repo root detection, git HEAD display, container logs on deploy, wait time increase, structured output
- `scripts/vps-smoke.sh`: accepts `DOMAIN` parameter, uses `set -euo pipefail`
- Added `scripts/vps-rollback.sh` for git tag-based rollback with health check verification

### Monitoring and Healthcheck
- `/api/health` endpoint reviewed: returns version, checks database, no secrets exposed, lightweight
- Added `docs/OPERATIONS_RUNBOOK.md` with healthcheck commands, Docker logs, nginx logs, disk/memory checks, restart commands, deploy/rollback commands, common failure troubleshooting

### nginx/SSL Documentation
- Updated `docs/DEPLOYMENT_CONTABO.md` with HTTPS smoke tests, SSL renewal, security header verification, monitoring commands

### README Updates
- Added Production Go-Live section with pre-launch checklist and links to all production docs

### No product feature changes
- No pricing, payment, supplier sync, vehicle compatibility, auth, search, or UI changes
- No landing page modifications

### Infrastructure
- Clean Contabo VPS reinstall and provisioning verified
- Docker Engine installation verified (`docker --version`, `docker compose version`)
- Repository cloned to `/opt/getirbakim-v2` via GitHub read-only deploy key
- `.env.production` kept only on VPS (never committed to repository)
- Docker app container running and reachable at `http://127.0.0.1:3000`
- Database health check OK (`/api/health` returns `checks.database: ok`, `version: v0.1.2`)
- nginx HTTP reverse proxy working on `http://getirbakim.com`
- `/tr` and `/en` pages verified (HTTP 200)
- `/api/health` verified through nginx (HTTP 200, database OK)
- HTTPS/SSL status: **pending** (Not yet configured; Certbot/Cloudflare setup to be done separately)
- Fixed local Docker Supabase session pool exhaustion by making PrismaPg pool size env-configurable
- Added `DATABASE_POOL_MAX` / `PG_POOL_MAX` env variables for configurable pool sizing
- Recommended pool sizes: local Docker 2, VPS production 4, upper clamp 10
- Prevents `EMAXCONNSESSION` during concurrent local + VPS runtimes

### Added
- `docs/nginx/getirbakim.conf.example` — example nginx reverse proxy configuration with SSL, gzip, and caching headers
- `scripts/vps-deploy.sh` — VPS deployment script (git pull, rebuild, health check)
- `scripts/vps-smoke.sh` — VPS smoke test script (internal + external HTTP/HTTPS checks)

### Changed
- `docker-compose.yml`: updated default `NEXT_PUBLIC_BUILD_VERSION` to `v0.1.2`, updated GHCR image name to `ghcr.io/aokcuoglu/getirbakim-v2:latest`
- `docs/DEPLOYMENT_CONTABO.md`: updated git clone URL, directory references, and version references to match current repository

### Deployment
- GitHub push/tag/release does not automatically update the VPS. Production update requires manual deploy via `scripts/vps-deploy.sh` or the documented `git pull` + `docker compose` workflow.
- CI/CD deployment automation should be a future release.

### No product feature changes
- No pricing, payment, supplier sync, vehicle compatibility, auth, search, or UI changes
- No landing page modifications

---

## v0.1.1 - Docker-first Local Runtime and Contabo VPS Deployment Readiness

### Hardened
- `docker-compose.local.yml`: added CookieYes build args, NODE_ENV=production, healthcheck points to `/api/health`, added `start_period`, fixed default URLs to `localhost:3001`
- `docker-compose.yml`: added local build strategy alongside GHCR image, NODE_ENV=production, healthcheck points to `/api/health`, added `start_period`, supports both VPS local-build and GHCR pull strategies
- `/api/health` endpoint simplified: removed rate limiting wrapper (Docker healthcheck must always pass), added `version` field from `NEXT_PUBLIC_BUILD_VERSION`

### Added
- `docs/DOCKER_LOCAL.md` — full local Docker runtime guide with prerequisites, commands, healthcheck, and troubleshooting
- `docs/DEPLOYMENT_CONTABO.md` — Contabo VPS deployment guide with server setup, nginx reverse proxy, SSL, rollback, and backup strategy
- `docs/ENVIRONMENT.md` — complete environment variable reference with Supabase pooler requirements, server-only vs public classification, and secret rotation guidance

### Changed
- README.md Docker section rewritten as Docker-first with links to new docs

### No product feature changes
- No pricing, payment, supplier sync, vehicle compatibility, auth, search, or UI changes
- No landing page modifications

---

## v0.1.0 - Initial GitHub Baseline

### Fixed
- Supabase PrismaPg connection fixed to use session pooler mode (port 5432) instead of transaction mode (port 6543 with pgbouncer=true)
- PrismaPg pool size reduced from 20 to 10 to stay within Supabase session pool limit (15)
- SSL configuration added to PrismaPg adapter for Supabase connections
- Type errors resolved in `lib/actions/admin-suppliers.ts` (undefined `autoMatchOrCreatePartAfterOemSave` stub) and `lib/suppliers/dinamik-job-queue.ts` (Prisma string vs literal union type narrowing)
- VAT calculation test expectations corrected to match 20% DISPLAY_VAT_RATE
- Dinamik catalog-seed route test fixed to mock `server-only` import chain

### Added
- `.env.example` updated with Supabase session pooler documentation and all required variable placeholders
- `docker-compose.local.yml` for local Docker builds (port 3001)
- `.gitignore` updated to protect `.env.*` and `.env.bak-*` files
- `CHANGELOG.md` and `RELEASE_NOTES.md` for release tracking

### Changed
- `NODE_ENV` in `.env` set to `development` for local dev

### Local Dev Verified
- App runs at http://localhost:3001
- `/api/me` returns 200
- `/tr` and `/en` pages return 200
- `/api/category-page` returns 200
- No Prisma P1000 authentication errors

### Quality Gates
- `bun run lint` — pass
- `bun run typecheck` — pass
- `bun run test` — 48 pass, 0 fail
- `bun run build` — pass
- `bunx prisma validate` — pass