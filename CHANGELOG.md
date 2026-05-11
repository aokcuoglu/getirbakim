# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.4] - 2026-05-11

### Added
- `lib/search/search-document-types.ts` — canonical search document type definitions with `canonical_part`, `supplier_offer`, `orphan_supplier_product` document types
- `lib/search/search-synonyms.ts` — Turkish/English automotive synonym mappings (21 synonym groups) and Meili synonym configuration
- `lib/search/supplier-part-matching.ts` — reindex-time candidate scoring for orphan supplier products (OEM exact, EAN exact, cross-reference exact, brand alias, name similarity)
- Three-phase Meilisearch reindex: supplier-backed → catalog-only → orphan supplier products
- Meilisearch document enrichment: vehicle fitment data (brand/model/type names, years, engine codes), offer counts, best offer provider, cross-references, reference numbers, search keywords, synonyms text
- `docs/SUPPLIER_PART_MATCHING.md` — canonical parts strategy, match reasons, auto-approve rules, orphan behavior, admin workbench requirements

### Changed
- `lib/search/search-document-builder.ts` — rewritten with canonical-parts-first document model, supplier offer enrichment, orphan supplier product indexing, vehicle fitment data, synonyms, search keywords, offer metadata
- `lib/search/setup-index.ts` — expanded searchable/filterable/sortable attributes, added synonym configuration
- `scripts/meili-setup.ts` — expanded index configuration with new attributes, synonyms, match status filters
- `scripts/meili-reindex.ts` — three-phase reindex (supplier-backed, catalog-only, orphan suppliers), configurable limits, summary counts
- `lib/search/catalog-offer-search.ts` — extended `CatalogOfferProduct` type with new search fields
- `lib/types/search.ts` — extended `SearchHit` interface with document type, match status, offer info, vehicle data
- `app/api/search/route.ts` — added `documentType`, `matchStatus`, `hasSupplierOffer` filters; expanded response fields
- `docs/SEARCH_MEILISEARCH_SELF_HOSTED.md` — updated architecture, document types, index fields, reindex phases
- `docs/SEARCH_CATALOG_OFFER.md` — updated for v0.2.4 strategy and supplier matching
- `docs/SUPPLIER_API_OPERATIONS.md` — added matching strategy section and new file references

### Tests
- Updated `lib/search/search-document-builder.test.ts` — new tests for canonical part docs, orphan supplier product docs, no-price REQUEST_PRICE, PURCHASABLE supplier offer, match confidence thresholds, synonym expansion, document ID validity

## [0.2.3] - 2026-05-09

### Added
- Self-hosted Meilisearch Docker service in `docker-compose.yml` and `docker-compose.local.yml`
- `lib/search/meilisearch-client.ts` — server-side Meili client with config validation and health check
- `lib/search/search-document-builder.ts` — unified document builder for supplier-backed and catalog-only products
- `scripts/meili-setup.ts` — index creation and configuration script
- `scripts/meili-reindex.ts` — batch reindexing from PostgreSQL into Meilisearch
- `app/api/internal/search/health/route.ts` — Meilisearch health diagnostic endpoint (CRON_SECRET protected)
- Package scripts: `search:setup` and `search:reindex`
- `docs/SEARCH_MEILISEARCH_SELF_HOSTED.md` — full setup, configuration, and troubleshooting guide

### Changed
- `/api/search` now queries Meilisearch first when `MEILI_ENABLED=true`, falls back to PostgreSQL catalog+offer search on Meili failure
- `/api/search` GET and POST handlers return `source: "meilisearch"` with full `CatalogOfferProduct` response shape when using Meili
- `/api/health` now reports Meilisearch reachability status with timing
- `docker-compose.yml` and `docker-compose.local.yml` now include `meilisearch` service, `app-network`, and persistent volumes
- `lib/meilisearch.ts` now delegates to `lib/search/meilisearch-client.ts` for server-side config
- `lib/search/setup-index.ts` now uses `products` index with searchable/filterable/sortable attributes for the unified document shape
- `lib/search/meili-admin.ts` now uses `getMeiliHost()` for consistent host resolution
- `.env.example` updated with detailed Meilisearch env vars and security warnings
- `MEILI_HOST` default changed to `http://127.0.0.1:7700` (outside Docker) / `http://meilisearch:7700` (inside Docker)
- Default search sort changed from empty array to `['rankScore:desc']` — products with price/stock rank higher

### Fixed
- Broad search queries (e.g., "Bosch") now complete in < 1s warm when Meili is enabled (vs 135s cold Prisma fallback)
- Response metadata includes `dataSource`, `liveFallbackUsed`, and `meiliFallbackReason` for observability
- Meilisearch index name is configurable via `MEILI_INDEX_PRODUCTS` env var instead of hardcoded `parts`
- **PostgreSQL fallback SQL**: Replaced `Prisma.sql` template interpolation in CTE strings with `escapeSqlLiteral()`/`escapeSqlLike()` helpers — prevents `[object Object]` in SQL causing `42601` syntax errors
- **PostgreSQL query execution**: Replaced `db.$queryRawUnsafe()` with `db.$queryRaw()` in `fetchSupplierBackedHits` and `fetchCatalogOnlyHits` — `$queryRawUnsafe` does not correctly handle `Prisma.sql` tagged template objects
- **Reindex script execution**: Removed `import 'server-only'` from `lib/search/search-document-builder.ts` so CLI scripts can run outside Next.js; removed unused imports from `scripts/meili-reindex.ts`
- **Docker runner**: Copied Bun binary from `oven/bun:1` build stage; added `tsconfig.json`, source files, Prisma schema, and required `node_modules` for reindex scripts
- **Docker `.dockerignore`**: Added `!scripts` and `!scripts/**` exceptions so scripts directory is available in Docker build context
- **SQL GROUP BY**: Fixed `JSONB_AGG` subqueries using `spo.updated_at`/`spo2.updated_at` ordering that caused PostgreSQL `42803` error — wrapped in subquery selectors
- **Reindex document IDs**: Meilisearch rejects `part:xxx` IDs containing colons (pre-existing format issue)

### Security
- `MEILI_MASTER_KEY` is server-only. Not exposed to browser. No `NEXT_PUBLIC_MEILI_*` vars required.
- Port 7700 is bound to `127.0.0.1` only in both compose files — not publicly accessible
- `/api/internal/search/health` requires `CRON_SECRET` authorization

### Tests
- Added `lib/search/catalog-offer-search-sql.test.ts` with 9 tests covering SQL escaping, `[object Object]` injection prevention, fallback behavior, availability status mapping, and page size caps

## [0.2.2] - 2026-05-09

### Changed
- Rewrote `getPartCategoryByUrlKey` in `lib/actions/getPartCategories.ts` to minimize DB round trips (4-8+ sequential queries → 2-3 batched queries)
- Replaced N+1 child count queries with batched `WHERE parent_id IN (...)` query
- Replaced iterative ancestry walk (1 query per parent) with single batched ancestor lookup
- Siblings and ancestry data now fetched in parallel
- Added `unstable_cache` ISR layer (1-hour revalidation) to `getPartCategoryByUrlKey`, `getMainNavCategories`, and `getPopularManufacturers`
- Warm ISR cache: nav/category/manufacturer data served with 0 DB queries, 0 Redis calls
- Redis remains as fallback inside ISR functions for cache warm-up and cross-instance sharing
- Added route timing instrumentation to category page, category layout, and category page payload builder
- Performance timing logs appear when `PERFORMANCE_LOGGING=true`

### Added
- Composite index `part_categories_active_url_key_idx` on `(is_active, url_key)` in Prisma schema
- SQL migration `20260509000000_add_category_performance_indexes`
- `docs/NAVIGATION_PERFORMANCE.md` — navigation performance bottleneck analysis, caching strategy, production checklist

### Fixed
- Nav/category data no longer requires per-request Redis calls when Next.js data cache is warm
- Category page navigation no longer triggers multiple sequential DB queries for slug resolution on warm ISR cache

### Fixed
- Category pages (e.g., `/en/fuel-filter`) no longer return 404 when `url_key` contains legacy numeric ID suffix
- Root cause: 959 of 979 active categories have `url_key` values like `"fuel-filter-100261"`. `normalizeUrlKey()` strips the suffix for link generation, but the lookup function only performed exact `url_key` match, missing these categories
- `getPartCategoryByUrlKey()` in `lib/actions/getPartCategories.ts` now falls back to `startsWith` prefix match + `normalizeUrlKey()` post-filter when exact `url_key` lookup fails
- `getCategorySearchIdFromUrlKey()` in `lib/actions/getPartCategories.ts` now falls back to suffixed match when exact `url_key` lookup fails
- Category links from `/en/filters` and all navigation components now resolve correctly for all 979 active categories

### Added
- 8 new tests for suffixed url_key resolution in `lib/actions/getPartCategories.test.ts`
- 3 new tests for canonical category URL generation in `lib/catalog-url.test.ts`
- Suffixed `url_key` fallback in category lookup (step 4 in slug resolution flow)
- Updated `docs/CATEGORY_ROUTING.md` with suffixed url_key resolution strategy

## [0.2.1] - 2026-05-07

### Added
- `lib/search/availability.ts` — availability status model (`PURCHASABLE`, `REQUEST_PRICE`, `VERIFY_FITMENT`, `OUT_OF_STOCK`) with CTA mapping
- `lib/search/catalog-offer-search.ts` — fast PostgreSQL catalog+offer search replacing slow Prisma fallback (~135s → <2s target)
- `scripts/search-indexes.sql` — recommended pg_trgm and composite indexes for search performance
- `docs/SUPPLIER_API_OPERATIONS.md` — supplier API operations documentation (Dinamik, SETA, Başbuğ)
- `docs/SEARCH_CATALOG_OFFER.md` — catalog-first + offer-prioritized search strategy documentation
- `FITMENT_CHECK` request type and `FITMENT_MODAL` source to customer requests
- `availabilityStatus`, `cta`, `detailUrl` fields to `SearchHit` type
- `products`, `page`, `limit`, `hasMore`, `totalEstimate`, `purchasableCount`, `requestPriceCount`, `verifyFitmentCount`, `outOfStockCount`, `durationMs` fields to search response
- Turkish/English i18n keys: `verifyFitment`, `requestPriceWhenAvailable`
- Tests for availability status mapping, CTA mapping, detail URL resolution, search result mapping

### Changed
- `/api/search` uses `runCatalogOfferSearch()` when `MEILI_ENABLED !== 'true'` instead of `runPrismaSearchFallback()`
- Search response `source` field changed from `'search-prisma-fallback'` to `'postgres_catalog_offer_search'`
- ProductCard and GridProductCard accept `availabilityStatus`, `cta`, `detailUrl` props for CTA rendering
- ProductCard CTA: no-price products show "Fiyat Al" (or "Uygunluk Sor" for fitment check)
- ProductCard and GridProductCard product links use `detailUrl` prop when available
- `customer_requests` schema: `request_type` and `source` enums extended with `FITMENT_CHECK` and `FITMENT_MODAL`

### Fixed
- Broad search queries (e.g., "Bosch") no longer take ~135 seconds; target response time under 2 seconds
- Catalog products without price/offer remain visible in search results instead of being hidden

## [0.2.0] - 2026-05-07

### Added
- `lib/performance/timing.ts` — server-side performance timing utility with `startTimer`, `endTimer`, `createTimerGroup`; logs only when `PERFORMANCE_LOGGING=true` or above `SLOW_QUERY_THRESHOLD`; never logs secrets
- `PERFORMANCE_LOGGING` env variable (default: false) and `SLOW_QUERY_THRESHOLD` env variable (default: 500ms, was 1000ms) in `.env.example`
- `docs/PERFORMANCE_BASELINE.md` — full performance baseline with endpoint timings, cache architecture, search analysis, index recommendations, and acceptance targets
- Redis caching for `getPopularManufacturers` (key: `popular-manufacturers-v1`, TTL: 3600s) — was previously uncached
- Redis availability check and DB timing to `/api/health` response
- Timing instrumentation to homepage, category, hierarchy, and manufacturer data paths
- Prisma indexes: `part_brands(logo_url)`, `part_categories(is_active, is_main_nav)`, `part_categories(is_active, parent_id)`, `part_cross_references(article_number, part_id)`, `part_eans(part_id)`, `part_oens(code, part_id)`

### Changed
- `getPartCategoryByUrlKey` rewritten to use targeted queries by ID/parent instead of loading ALL categories from DB on every Redis miss — reduces cold-cache queries from O(N) full-table scan to O(depth) targeted lookups
- `getCategorySearchIdFromUrlKey` rewritten to trace ancestry via iterative parent lookups instead of loading all active categories — eliminates full-table scan for ancestry verification
- `SLOW_QUERY_THRESHOLD` default reduced from 1000ms to 500ms
- `lib/query-monitor.ts` — cleaned up to use consistent named constant for threshold

### Removed
- `vehicle_brands.count()` debug query removed from `getDropdownData('vehicle_brands')` in hierarchy service — was an unnecessary DB call on every invocation

### Performance
- Search endpoint (Prisma fallback) identified as critical bottleneck: 135s for broad queries on cold cache
- MeiliSearch currently disabled — all search routed through slow Prisma fallback
- Homepage cold cache ~1.9s, warm ~0.2s
- Health endpoint warm ~180ms
- Full baseline documented in `docs/PERFORMANCE_BASELINE.md`

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