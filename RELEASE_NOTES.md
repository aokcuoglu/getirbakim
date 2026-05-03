# Release Notes — v0.3.0 Existing Supabase Catalog DB Integration

**Release Date:** 2026-05-03

## Overview

v0.3.0 integrates the existing Supabase PostgreSQL database as the main product catalog source. The `supplier_products` table (populated by Dinamik, SETA, and ParcaTedarik) is now the primary search data source when `USE_EXISTING_CATALOG_DB=true`. This eliminates the need to call supplier APIs on every search, making product search fast and reliable.

**Note:** Price and stock information from the catalog DB should still be verified before commercial order confirmation. DB-backed search provides catalog data; live supplier APIs remain available for future price/stock validation.

## Highlights

- Integrated existing Supabase catalog database as the main product search source
- Validated against 390,993 catalog products from Dinamik, SETA, and ParcaTedarik
- Implemented DB-backed search over `supplier_products`
- Supplier identity is resolved through `provider_id` → `supplier_providers.name` (not `supplier_products.supplier_name`, which contains product descriptions)
- Added protected admin page for catalog DB status
- Added safe normalized search responses; `raw_json` is never exposed to the browser
- Preserved mock/live fallback architecture for future supplier validation
- Docker verified on http://localhost:3001

## Known Notes

- Price and stock should still be re-verified before commercial order confirmation
- Başbuğ supplier catalog import is planned for a future release
- Vehicle fitment, VIN/chassis, and plate search are not included in this release

## Breaking Changes

- Search API response now includes optional `dataSource`, `supplierCounts`, and `liveFallbackUsed` fields
- Product card UI shows "Katalog verisi" badge and supplier name tags when results come from DB
- New env vars required for DB-backed search: `DATABASE_URL`, `DIRECT_URL`, `USE_EXISTING_CATALOG_DB`, `CATALOG_SEARCH_SOURCE`

## Features

### DB-Backed Catalog Search
- Searches `supplier_products` table using `pg` driver (read-only, no migrations)
- Configurable via `USE_EXISTING_CATALOG_DB` and `CATALOG_SEARCH_SOURCE` env vars
- Searches across `supplier_sku`, `supplier_name`, `supplier_brand`, `supplier_category`, and `raw_payload` (ILIKE)
- Results normalized into standard product DTO — `raw_payload` never sent to browser
- Live fallback: if `SEARCH_LIVE_FALLBACK_ENABLED=true` and DB returns no results, falls back to live supplier APIs
- DB results include per-supplier counts and data source metadata

### Catalog DB Connection Module
- `src/lib/catalog-db.ts` — server-only PostgreSQL connection pool using `pg` driver
- `src/lib/catalog-search.ts` — catalog search service with field mapping
- Works with Supabase Shared Connection Pooler (`DATABASE_URL` with pgbouncer)
- `DIRECT_URL` used for schema inspection and possible future migrations
- Safe error handling, no credential exposure

### Admin: Catalog DB Dashboard
- New admin page: `/admin/existing-db` (protected by admin auth)
- Shows: DB connection status, total row count, count by supplier, detected supplier column, column schema, and search test
- New admin API: `GET /api/admin/catalog-db` (protected by admin auth)

### Search UI Updates
- "Katalog verisi" (catalog data) badge shown when results come from DB
- Supplier name tags displayed on each product card (Dinamik, Parçatedarik, Seta)
- Warning: "Fiyat ve stok bilgisi talep öncesinde tekrar doğrulanır" for DB-backed results
- Live fallback notice shown when both DB and live results are combined

### DB Inspection Script
- `scripts/inspect-existing-supabase-catalog.ts` — read-only schema and data inspection
- Lists columns, indexes, row count, supplier distribution, and sample rows
- Masks `raw_payload` and never prints credentials
- Run with: `npx tsx scripts/inspect-existing-supabase-catalog.ts`

### Environment Variables
- `DATABASE_URL` — Supabase connection pooler URL (server-side only, never expose to browser)
- `DIRECT_URL` — Supabase direct connection URL (server-side only)
- `USE_EXISTING_CATALOG_DB` — `true` | `false` (default: `false`)
- `CATALOG_SEARCH_SOURCE` — `mock` | `existing-db` (default: `mock`)
- `SUPPLIER_CATALOG_TABLE` — table name (default: `supplier_products`)
- `SUPPLIER_DB_SCHEMA` — schema (default: `public`)
- `SEARCH_LIVE_FALLBACK_ENABLED` — `true` | `false` (default: `false`)

## Infrastructure

### Docker
- All new env vars passed through `docker-compose.yml`
- Host port remains 3001, container port 3000
- Rebuild: `docker compose build --no-cache && docker compose up -d`

## Pages

| Route | Description |
|-------|-------------|
| `/` | Homepage with search hero |
| `/search?q=` | Product search results (DB-backed when enabled) |
| `/products/[id]` | Product detail with offers |
| `/request` | Product request form |
| `/admin/requests` | Admin request list |
| `/admin/suppliers/health` | Supplier health status |
| `/admin/suppliers/logs` | Supplier API call logs |
| `/admin/existing-db` | **NEW** Catalog DB dashboard |
| `/privacy` | Privacy policy |
| `/kvkk` | KVKK disclosure |
| `/returns` | Return policy |
| `/distance-sales` | Distance sales agreement |

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/search` | GET | Search products (DB-backed, rate limited, cached) |
| `/api/products/[id]` | GET | Product detail |
| `/api/requests` | GET, POST | List/create requests |
| `/api/requests/[id]` | PATCH | Update request status |
| `/api/supplier-health` | GET | Supplier health check |
| `/api/admin/supplier-logs` | GET | Supplier API logs (admin auth) |
| `/api/admin/catalog-db` | GET | **NEW** Catalog DB stats (admin auth) |

## Known Limitations

- No payment integration (future release)
- No VIN/chassis search (future release)
- No plate search (future release)
- No vehicle fitment data (future release)
- No user authentication (future release)
- Search cache is in-memory only; Redis recommended for production multi-instance
- Rate limiter is in-memory only; Redis recommended for production multi-instance
- Catalog DB search uses ILIKE which may be slow on very large datasets — consider adding full-text search indexes
- Price/stock from catalog DB should be verified before commercial order confirmation
- Supplier B and C adapters are stubs (not connected to real APIs)
- `raw_payload` field extraction is best-effort — different suppliers may use different field names

## Migration from v0.2.x

1. Pull the latest code
2. Add new env vars to `.env` or `.env.local`:

```
DATABASE_URL=<your-supabase-pooler-url>
DIRECT_URL=<your-supabase-direct-url>
USE_EXISTING_CATALOG_DB=true
CATALOG_SEARCH_SOURCE=existing-db
SUPPLIER_CATALOG_TABLE=supplier_products
SUPPLIER_DB_SCHEMA=public
SEARCH_LIVE_FALLBACK_ENABLED=false
```

3. Rebuild Docker: `docker compose build --no-cache && docker compose up -d`
4. Verify at `/admin/existing-db` — connection status and supplier counts should display

**Important:** Never commit real `DATABASE_URL` or `DIRECT_URL` values to git. They must only exist in local `.env` or server environment.

---

# Release Notes — v0.2.0 Real Supplier API Integration Foundation

**Release Date:** 2026-05-03

## Overview

v0.2.0 completes the real Supplier A (Dinamik Oto) API integration foundation. Supplier A live search is validated and operational. This release includes supplier mode configuration, search caching, rate limiting, admin supplier log visibility, proxy support, and UI trust signals.

**Note:** Supplier A live search validated with selected queries (BOSCH, 3M, ABA, TRW). Some field semantics such as VAT/stock interpretation require supplier confirmation.

## Breaking Changes

- `SupplierAdapter` interface now includes `apiKey` and `baseUrl` readonly properties (for mode-aware adapter registry)
- Search API response now includes `lastCheckedAt` field
- Product detail API response now includes `lastCheckedAt` field

## Features

### Supplier Mode Configuration
- `SUPPLIER_MODE` environment variable: `mock` | `live` | `hybrid` (default: `mock`)
  - `mock`: Only mock supplier data. No real API calls.
  - `live`: Only real supplier adapters. Mock is excluded.
  - `hybrid`: Real adapters when enabled/configured, mock as fallback.
- `SUPPLIER_A_ENABLED` flag (default: `false`) to explicitly enable Supplier A
- `SUPPLIER_A_TIMEOUT_MS` (default: 8000) per-supplier timeout configuration
- New `src/suppliers/config.ts` module for mode and config resolution

### Supplier A Adapter Hardening
- Per-supplier timeout via `SUPPLIER_A_TIMEOUT_MS` env var
- Per-supplier try/catch wrapping on all adapter methods
- Safe error message normalization (never exposes API keys)
- Only active when `SUPPLIER_A_ENABLED=true` and credentials are configured
- Supplier B and C adapters also updated with the same safety patterns

### Search Caching
- In-memory TTL cache for identical search queries
- Default TTL: 60 seconds, configurable via `SEARCH_CACHE_TTL_SECONDS`
- Cache key includes query and supplier mode
- Only successful results are cached; errors are never cached
- `src/suppliers/cache.ts` — simple v0.2.0 cache, Redis can replace for multi-instance

### Rate Limiting
- In-memory per-IP rate limiting for `/api/search`
- Default: 30 requests per 60 seconds per IP
- Configurable via `SEARCH_RATE_LIMIT_WINDOW_SECONDS` and `SEARCH_RATE_LIMIT_MAX`
- Respects `x-forwarded-for` and `x-real-ip` headers
- Returns 429 with friendly Turkish message when exceeded
- `src/lib/rate-limit.ts`

### getProductDetails Hardening
- Each adapter `getProduct()` call wrapped in isolated try/catch
- One supplier throwing no longer aborts the entire product detail lookup
- Partial result behavior preserved

### Supplier API Logging
- All supplier adapters now log to both in-memory buffer and `supplier_api_logs` Supabase table
- Log entries include: supplier name, operation, success/failure, duration_ms, status_code, error message
- API keys are never logged
- In-memory log buffer (last 500 entries) accessible via admin API
- New admin page: `/admin/suppliers/logs` showing latest API calls and failures
- New admin API: `GET /api/admin/supplier-logs` (protected by admin auth)
- Shows: supplier mode, log count, cache stats, rate limit stats, and individual log entries

### Admin Auth Protection
- `/api/admin/*` routes now require HTTP Basic Auth
- Middleware matcher updated to include `/api/admin/:path*`

### Admin Request Operations
- Existing request status management with dropdown already implemented
- Status options: pending, contacted, quoted, closed, cancelled
- Protected by admin auth via middleware + `src/lib/admin-auth.ts`

### UI Trust Updates
- Search results page shows "Son kontrol zamanı" (last checked time) with clock icon
- Product detail page shows "Son kontrol zamanı" with clock icon
- Partial supplier failure message now clearly states: "Bazı tedarikçilerden yanıt alınamadı, mevcut sonuçlar gösteriliyor."
- Rate limit 429 responses show friendly Turkish error message

### Environment Variables
- Added to `.env.example` and `docker-compose.yml`:
  - `SUPPLIER_MODE=mock`
  - `SUPPLIER_A_ENABLED=false`
  - `SUPPLIER_A_TIMEOUT_MS=8000`
  - `SEARCH_CACHE_TTL_SECONDS=60`
  - `SEARCH_RATE_LIMIT_WINDOW_SECONDS=60`
  - `SEARCH_RATE_LIMIT_MAX=30`

## Infrastructure

### Docker
- All new env vars added to `docker-compose.yml`
- Host port remains 3001, container port 3000
- Rebuild after changes: `docker compose build --no-cache && docker compose up -d`

## Pages

| Route | Description |
|-------|-------------|
| `/` | Homepage with search hero |
| `/search?q=` | Product search results (with cache + rate limit) |
| `/products/[id]` | Product detail with offers |
| `/request` | Product request form |
| `/admin/requests` | Admin request list (status management) |
| `/admin/suppliers/health` | Supplier health status |
| `/admin/suppliers/logs` | **NEW** Supplier API call logs |
| `/privacy` | Privacy policy |
| `/kvkk` | KVKK disclosure |
| `/returns` | Return policy |
| `/distance-sales` | Distance sales agreement |

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/search` | GET | Search products (rate limited, cached) |
| `/api/products/[id]` | GET | Product detail |
| `/api/requests` | GET, POST | List/create requests |
| `/api/requests/[id]` | PATCH | Update request status |
| `/api/supplier-health` | GET | Supplier health check |
| `/api/admin/supplier-logs` | GET | **NEW** Supplier API logs (admin auth) |

## Known Limitations

- No payment integration (future release)
- No VIN/chassis search (future release)
- No plate search (future release)
- No vehicle fitment data (future release)
- No user authentication (future release)
- Search cache is in-memory only (not shared across instances); Redis recommended for production multi-instance
- Rate limiter is in-memory only; Redis recommended for production multi-instance
- Supplier A has no free-text search — only brand name and exact stock code lookup are supported
- Supplier A stock availability is binary (available/unavailable), not real quantity
- Supplier A OEM numbers (`oemListe`) are empty for major brands (BOSCH, TRW, 3M, ABA)
- Supplier A images (`resimUrl`) are empty for tested brands
- Price VAT inclusion and price type (net/list/discounted) are unconfirmed — require supplier documentation
- Supplier B and C adapters are stubs (not connected to real APIs)

## Migration from v0.1.x

1. Pull the latest code
2. Update environment variables (see `.env.example` for new vars)
3. Set `SUPPLIER_MODE=mock` for existing deployments (this is the default)
4. Run `supabase/migrations/003_request_statuses.sql` if not already applied
5. Rebuild Docker: `docker compose build --no-cache && docker compose up -d`

---

# Release Notes — v0.1.0 Supplier Search MVP

**Release Date:** 2025-05-01

## Overview

Initial MVP release of getirbakim.com — an open-source automotive spare parts search platform for Türkiye. This release focuses on live supplier search, product detail pages, request collection, and admin visibility.

## Features

### Core Search
- Multi-supplier parallel product search with partial failure tolerance
- Product search by name, brand, category, and OEM number
- Real-time aggregation of results from all active suppliers
- Automatic sorting by best price

### Product Detail Pages
- Unified product view with all supplier offers
- OEM number display
- Stock and delivery time information per supplier
- Direct link to create a product request

### Product Requests
- Customer-facing request form for products not found or needing follow-up
- Vehicle info and notes fields
- Email and phone collection for contact-back

### Admin
- Request list page (`/admin/requests`) with status tracking — **protected by HTTP Basic Auth**
- Supplier health dashboard (`/admin/suppliers/health`) — **protected by HTTP Basic Auth**
- Real-time API health monitoring per supplier
- Middleware-based auth: `ADMIN_USERNAME` / `ADMIN_PASSWORD` env vars
- Fail-closed: if password not set, admin routes return 401
- `POST /api/requests` remains public; `GET/PATCH/DELETE` require admin auth

### Privacy & Compliance
- KVKK consent checkbox required on request form before submission
- Consent timestamp recorded in database (`kvkk_consent`, `kvkk_consent_at`)
- API validates `kvkk_consent === true`, returns 400 if missing
- Customer PII never exposed without authentication

### Supplier Adapter Architecture
- Common `SupplierAdapter` interface for all suppliers
- Mock adapter for local development (zero-config)
- Placeholder adapters for Supplier A, B, and C (activate with env vars)
- Adapter registry for easy addition of new suppliers
- Server-side API logging to `supplier_api_logs`

### Legal Pages
- Privacy Policy (`/privacy`)
- KVKK Disclosure (`/kvkk`)
- Return Policy (`/returns`)
- Distance Sales Agreement (`/distance-sales`)

### Infrastructure
- Docker + Docker Compose for deployment (no `.env.local` file required to build)
- `.dockerignore` for clean builds
- MIT License
- Supabase database schema with RLS policies
- Standalone Next.js build for containerized deployment