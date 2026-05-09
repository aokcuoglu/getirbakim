# Release Notes

## v0.2.2 - Category Route Resolution Bugfix

### Category Route Transition Optimization
- Rewrote `getPartCategoryByUrlKey` to minimize DB round trips from 4-8+ sequential queries to 2-3 batched queries
- Replaced N+1 child count queries with single `WHERE parent_id IN (...)` batched query
- Replaced iterative ancestry walk (1 query per parent) with batched ancestor lookup (single `findMany` for all ancestors)
- Siblings and ancestry data now fetched in parallel
- Added `unstable_cache` ISR layer with 1-hour revalidation and Redis fallback
- React `cache()` per-request deduplication still applies inside ISR function

### Nav and Category Data Caching
- Added Next.js `unstable_cache` ISR layer to `getMainNavCategories` (key: `main-nav-categories-v3`, revalidate: 3600s)
- Added Next.js `unstable_cache` ISR layer to `getPopularManufacturers` (key: `popular-manufacturers-v2`, revalidate: 3600s)
- Added Next.js `unstable_cache` ISR layer to `getPartCategoryByUrlKey` (key: `part-category-by-urlkey-v3`, revalidate: 3600s)
- On warm ISR cache: 0 DB queries, 0 Redis calls for nav/category/manufacturer data
- Redis remains as fallback inside ISR functions for cache warm-up and cross-instance sharing

### Route Timing Instrumentation
- Added `createTimerGroup` to category page (`categoryPage`), category layout (`categoryLayout`), and category page payload builder (`categoryPagePayload`)
- Timing logs appear when `PERFORMANCE_LOGGING=true` in `.env`

### Database Index
- Added composite index `part_categories_active_url_key_idx` on `(is_active, url_key)` to Prisma schema
- Added SQL migration `20260509000000_add_category_performance_indexes`
- Supports the most common slug resolution query: `WHERE is_active = true AND url_key = ?`

### Caching Architecture (v0.2.2)
| Layer | Mechanism | TTL | Scope |
|-------|-----------|-----|-------|
| Next.js Data Cache | `unstable_cache` | 1 hour | Category by urlKey, Main nav, Popular manufacturers, Catalog data |
| Redis (Upstash) | `lib/redis.ts` | 1 hour | All server data (fallback inside unstable_cache) |
| React `cache()` | Per-request | Single render | `getPartCategoryByUrlKey` dedup |
| CDN | middleware `Cache-Control` | s-maxage=300 | Anonymous HTML pages |

### No Behavior Changes
- No product, payment, supplier sync, vehicle compatibility, auth, search, or checkout changes
- No UI redesign
- No-price products remain visible
- Search endpoint unchanged
- MEILI_ENABLED=false compatible
- Docker-first local runtime and VPS deploy workflow unchanged

### Documentation
- Added `docs/NAVIGATION_PERFORMANCE.md` with full bottleneck analysis, caching strategy, and production checklist
- Updated `docs/CATEGORY_ROUTING.md` with v0.2.2 caching improvements and slug resolver optimization
- Updated `docs/PERFORMANCE_BASELINE.md` with v0.2.2 cache architecture and index additions
- Updated `RELEASE_NOTES.md` and `CHANGELOG.md`

### Category Route Resolution
- Fixed category pages (e.g., `/en/fuel-filter`) returning 404 when `url_key` in the database contains a legacy numeric ID suffix
- Root cause: 959 of 979 active categories have `url_key` values like `"fuel-filter-100261"` (with a 5+ digit numeric suffix). `normalizeUrlKey()` strips these suffixes for link generation (producing `"fuel-filter"`), but `getPartCategoryByUrlKey()` only performed an exact `WHERE url_key = 'fuel-filter'` match, which always returned 0 rows for these categories
- Added suffixed url_key fallback in `getPartCategoryByUrlKey()`: when exact `url_key` match fails, queries `WHERE url_key LIKE '{urlKey}-%'` and filters results by `normalizeUrlKey()` to find the canonical match
- Added same fallback in `getCategorySearchIdFromUrlKey()` for category ID resolution
- No link generation changes needed — links already used `normalizeUrlKey()` consistently
- No product/payment/checkout behavior changes
- Category pages for valid categories no longer 404

### Category URL Strategy
- SEO-friendly category URLs: `/{locale}/{categorySlug}` (e.g., `/en/fuel-filter`, `/tr/yakit-filtresi`)
- Categories with clean `url_key` in DB (19 categories like `filters`, `car-parts`): resolved by exact `url_key` match
- Categories with legacy ID-suffixed `url_key` (959 categories like `fuel-filter-100261`): resolved by `startsWith` prefix match + `normalizeUrlKey()` post-filter
- Categories without `url_key` (1 category with null): resolved by name-derived slug fallback (`generateSlug(name)` or `generateSlug(name_tr)`)
- Turkish locale: also matches `name_tr`-derived slugs (e.g., `yakit-filtresi` from "Yakıt filtresi")
- `next.config.mjs` redirects strip legacy ID suffixes from URLs: `/en/fuel-filter-100261` → `/en/fuel-filter`

### Slug Resolution Flow (updated)
1. **Redis cache** — `part-category-v2-{urlKey}`
2. **Legacy ID suffix** — if urlKey matches `-(\d+)$`, parse ID and look up directly
3. **Exact `url_key` match** — `WHERE is_active = true AND url_key = urlKey`
4. **Suffixed `url_key` fallback** — `WHERE is_active = true AND url_key LIKE '{urlKey}-%'`, then filter by `normalizeUrlKey()` matching urlKey
5. **Name-derived slug fallback** — `WHERE is_active = true AND url_key IS NULL`, then match `generateSlug(name) === urlKey` or `generateSlug(name_tr) === urlKey`
6. **notFound()** — if none of the above match

### Tests
- Added 8 new tests for suffixed url_key resolution in `lib/actions/getPartCategories.test.ts`
- Added 3 new tests for canonical category URL generation in `lib/catalog-url.test.ts`
- Tests confirm `normalizeUrlKey` correctly strips ID suffixes, filters false positives, and produces consistent slugs
- All 100 tests pass

## v0.2.1 - Catalog + Offer Search MVP

### Catalog + Offer Search
- Replaced slow Prisma fallback search (~135s for "Bosch") with fast PostgreSQL catalog+offer search (<2s target)
- New `runCatalogOfferSearch()` uses tiered SQL queries: exact SKU/OEM/EAN, then brand, then name contains
- Supplier-backed products with price and stock prioritized at top of results
- Catalog-only products without offers remain visible with "Fiyat Al" (Request Price) CTA
- No expensive joins with vehicle compatibility in search path
- Strict limits: max 60 results per page, max 30 catalog-only results

### Availability Status Model
- Added typed `AvailabilityStatus`: `PURCHASABLE`, `REQUEST_PRICE`, `VERIFY_FITMENT`, `OUT_OF_STOCK`
- Added typed `SearchCTA`: `add_to_cart`, `request_price`, `verify_fitment`, `notify_or_request_price`
- CTA mapping: PURCHASABLE → Sepete Ekle, REQUEST_PRICE → Fiyat Al, VERIFY_FITMENT → Uygunluk Sor, OUT_OF_STOCK → Stok Gelince Haber Ver
- Search results include `availabilityStatus`, `cta`, `detailUrl` fields
- Response includes `purchasableCount`, `requestPriceCount`, `verifyFitmentCount`, `outOfStockCount`

### Search Response Enhancements
- `/api/search` returns `dataSource: "postgres_catalog_offer_search"` when using new path
- `liveFallbackUsed: false` indicates no live supplier API calls during search
- `durationMs` for search timing
- `hasMore`, `totalEstimate` for pagination metadata

### UI Updates
- ProductCard and GridProductCard support new `availabilityStatus` and `cta` props
- "Fiyat Al" button for no-price products via CustomerRequestDialog
- "Uygunluk Sor" button for fitment verification (prepared for v0.2.2)
- Detail URL links to `/part/[id]` or `/supplier-product/[id]`

### Request Price Preparation
- Added `FITMENT_CHECK` request type and `FITMENT_MODAL` source to customer requests
- Prepared route/link structure for v0.2.2 full request price flow

### Supplier API Documentation
- Added `docs/SUPPLIER_API_OPERATIONS.md` with Dinamik, SETA, Başbuğ strategy
- Covered: periodic sync schedule, live check policy, failure handling, stale data detection

### Search Documentation
- Added `docs/SEARCH_CATALOG_OFFER.md` explaining catalog-first + offer-prioritized strategy
- Documented: result statuses, ranking rules, performance targets, index recommendations, limitations

### Index Recommendations
- Added `scripts/search-indexes.sql` with pg_trgm indexes for normalized fields
- Recommended indexes for: supplier_products, supplier_product_oems, supplier_part_mappings, parts, part_brands, part_eans, part_oens, part_cross_references

### Meilisearch
- Meilisearch remains disabled. Integration code preserved for future re-enablement.
- No changes to Meilisearch integration when `MEILI_ENABLED=true`.

## v0.2.0 - Performance Baseline and Catalog Reliability

### Performance Baseline
- Measured baseline timings for all critical endpoints: homepage, health, search, category pages
- Established acceptance targets for key performance metrics
- Created `docs/PERFORMANCE_BASELINE.md` with full baseline data, cache architecture, and recommendations

### Server-Side Timing Instrumentation
- Added `lib/performance/timing.ts` — lightweight timing utility with named operations, timer groups, and threshold-based logging
- `PERFORMANCE_LOGGING` env variable enables verbose logging (default: false)
- `SLOW_QUERY_THRESHOLD` env variable controls slow query warning threshold (default: 500ms, was 1000ms)
- Instrumented homepage data loading (`catalogData`, `manufacturers`, `mainNav`)
- Instrumented `getPartCategories`, `getPartCategoriesForVehicle`, `getMainNavCategories` with cache hit/miss tracking
- Instrumented `getCatalogCategories`, `getPopularManufacturers` with cache hit/miss tracking
- Instrumented hierarchy service `getDropdownData` with cache hit/miss tracking
- Updated `lib/query-monitor.ts` to use consistent threshold and removed duplicate env parsing
- Added Redis availability check and DB timing to `/api/health` response

### Catalog and Search Measurement
- Search endpoint already had Server-Timing headers and timing logs (pre-existing)
- Catalog category data loading paths now tracked end-to-end
- Category page resolution (`getPartCategoryByUrlKey`) now has full timing instrumentation

### Cache Improvements
- Added Redis caching to `getPopularManufacturers` (was uncached, now 1h TTL with key `popular-manufacturers-v1`)
- Removed `vehicle_brands.count()` debug query from `getDropdownData('vehicle_brands')` — unnecessary DB call on every invocation
- Optimized `getPartCategoryByUrlKey` to use targeted queries instead of loading ALL categories (reduces cold-cache DB load from O(N) full-table scan to O(depth) targeted lookups)
- Optimized `getCategorySearchIdFromUrlKey` to trace ancestry via iterative parent lookups instead of loading all categories
- Documented all cache keys and TTLs in `docs/PERFORMANCE_BASELINE.md`

### DB Index Recommendations
- Added Prisma indexes: `part_brands(logo_url)`, `part_categories(is_active, is_main_nav)`, `part_categories(is_active, parent_id)`, `part_cross_references(article_number, part_id)`, `part_eans(part_id)`, `part_oens(code, part_id)`
- Documented additional SQL index recommendations for future releases in `docs/PERFORMANCE_BASELINE.md`

### Search Findings
- Confirmed MeiliSearch is disabled — all search goes through Prisma fallback
- Broad search queries (e.g., "Bosch") take 135+ seconds on cold cache due to deeply nested OR conditions across 10+ tables
- Code-like queries (e.g., OEM numbers) use fast lookup path and are significantly faster
- Search Redis cache mitigates repeat queries (300s TTL for Meili, 120s for Prisma fallback)

### No product UI redesign
- No pricing, payment, supplier sync, vehicle compatibility, or order behavior changes
- No visual or UX changes to any page

---

## v0.1.5 - Deploy Version Consistency and VPS Compose Hardening

### Deployment Version Consistency
- Fixed `/api/health` version reporting: deploy script now injects `NEXT_PUBLIC_BUILD_VERSION` at Docker build time instead of relying on `.env.production`
- GitHub Actions workflow now determines deploy version from: manual input > tag name > short commit SHA
- Deploy script (`scripts/vps-deploy.sh`) derives version in priority order: `NEXT_PUBLIC_BUILD_VERSION` env var > `GITHUB_REF_NAME` > `VERSION` > git tag > short SHA > fallback "dev"
- Health endpoint correctly reports the version of the deployed release, not a stale hardcoded value

### VPS Compose Strategy Hardening
- Removed stale `image: ghcr.io/aokcuoglu/getirbakim-v2:latest` from `docker-compose.yml` — production VPS builds from local Dockerfile only
- Removed hard-coded `NEXT_PUBLIC_BUILD_VERSION:-v0.1.3` default from `docker-compose.yml` — replaced with `dev` fallback
- Updated `docker-compose.yml` comments to document local build strategy and version injection
- Updated `docker-compose.local.yml` comments to remove reference to GHCR image strategy

### GitHub Actions Workflow Updates
- Added `version` input to `workflow_dispatch` trigger (optional string, e.g. `v0.1.5`)
- Added version determination step: resolves from input, tag name, or commit SHA
- Passes `NEXT_PUBLIC_BUILD_VERSION` to deploy script via SSH command
- Deploy script exports `NEXT_PUBLIC_BUILD_VERSION` and passes it to `docker compose up --build`

### VPS Deploy Script Hardening
- `scripts/vps-deploy.sh` now computes and exports `NEXT_PUBLIC_BUILD_VERSION` before `docker compose up --build`
- Prints deploy version before and after build
- Reports health check version after deploy for verification
- Increased container startup wait from 15s to 20s
- Does not require `.env.production` to contain `NEXT_PUBLIC_BUILD_VERSION`

### Documentation Updates
- `docs/GITHUB_ACTIONS_DEPLOY.md`: documented version inference logic, manual workflow_dispatch version input, build version priority order, updated security checklist
- `docs/DEPLOYMENT_CONTABO.md`: removed `NEXT_PUBLIC_BUILD_VERSION` from `.env.production` critical settings, added version injection instructions, updated deploy/rollback commands to pass `NEXT_PUBLIC_BUILD_VERSION`
- `docs/OPERATIONS_RUNBOOK.md`: updated version in example health response, updated all deploy/rollback commands to include `NEXT_PUBLIC_BUILD_VERSION`, added version source explanation
- `README.md`: updated production deploy instructions to use deploy script and note about build version

### Post-v0.1.4 Fixes
- This release captures the version consistency fixes that were missing from v0.1.4
- v0.1.4 deployed successfully but reported `v0.1.2` via `/api/health` due to stale `.env.production`
- After v0.1.5, `/api/health` will correctly report the deployed version

### No product feature changes
- No pricing, payment, supplier sync, vehicle compatibility, auth, search, or UI changes
- No landing page modifications

---

## v0.1.4 - GitHub Actions SSH Deploy Automation

### GitHub Actions Deployment
- Added `.github/workflows/deploy-vps.yml` — controlled SSH-based deployment workflow
- Triggers on `workflow_dispatch` (manual) and `push` tags matching `v*`
- Does NOT auto-deploy on every push to `main`
- Deploys via SSH: pulls latest code, rebuilds Docker, restarts app, runs smoke tests
- Uses native SSH commands (no third-party action dependencies)
- Cleans up SSH key from runner after each run

### VPS Script Hardening
- `scripts/vps-deploy.sh`: accepts `PROJECT_PATH`, `BRANCH`, `DOMAIN` env vars; verifies `.env.production` exists before rebuild; fails cleanly on health check failure; 15s wait for container startup; shows before/after commit; does not print secrets
- `scripts/vps-smoke.sh`: accepts `DOMAIN` env var or argument; checks internal endpoints (health, /tr, /en) plus public HTTPS if domain set; 10s curl timeout; exits non-zero on any failure
- `scripts/vps-rollback.sh`: accepts `ROLLBACK_REF` env var or argument; fetches tags from origin; validates ref exists; verifies `.env.production` before rebuild; fails on health check failure with logs; saves rollback point

### Documentation
- Added `docs/GITHUB_ACTIONS_DEPLOY.md` — GitHub Actions deploy setup, SSH key generation, GitHub Secrets reference, deploy key vs SSH key distinction, rollback instructions, root user warning, security checklist
- Updated `docs/OPERATIONS_RUNBOOK.md` — added GitHub Actions deploy section, script env var usage, rollback env var, GitHub Actions failure troubleshooting (SSH auth, known_hosts, .env.production missing, git pull, docker build, smoke, nginx stale)
- Updated `docs/PRODUCTION_SECURITY_CHECKLIST.md` — added GitHub Secrets section, deploy workflow security checklist, root user documentation, SSH key rotation guidance
- Updated `README.md` — added Automated VPS Deployment section with link to docs

### Replaced Workflow
- Removed old `.github/workflows/deploy.yml` (GHCR-based, auto-deploy on main push, had path and service name mismatches)
- Replaced with `.github/workflows/deploy-vps.yml` (SSH-based, controlled trigger, uses existing VPS deploy scripts)

### No product feature changes
- No pricing, payment, supplier sync, vehicle compatibility, auth, search, or UI changes
- No landing page modifications

---

## v0.1.3 - Production Go-Live Hardening

### Secret Hygiene Hardening
- Added `scripts/secret-scan.sh` — release guard that scans tracked files, staged diffs, and gitignore status without broad recursive grep
- Hardened `.gitignore`: added `!.env.*.example`, `*.env.bak`, `*.env.backup`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519` (removed duplicate `*.pem`)
- Hardened `.dockerignore`: explicit `.env`/`.env.*`/`!.env.example` exclusions, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`
- Clarified policy: ignored local `.env` files are allowed, but tracked/staged secrets are blocking
- Removed `.env.bak-*` and `.env.production` from repository root (backed up externally)
- Updated `docs/PRODUCTION_SECURITY_CHECKLIST.md` with secret hygiene policy and scan script reference

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