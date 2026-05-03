# getirbakim.com — Agent Instructions

## Project Overview

getirbakim.com is an open-source automotive spare parts e-commerce platform for Türkiye. The current release (v0.3.2) features a product request / sales lead MVP flow on top of the existing catalog search storefront.

## Architecture

- **Next.js 16 App Router** with TypeScript and Tailwind CSS v4
- **Supabase Pro** for database/auth/storage
- **Existing Supabase Catalog DB** — `supplier_products` table is the main product catalog source
- **Supplier Adapter Pattern** — each supplier has its own adapter implementing a common interface
- **Mock adapter** works without real API credentials for local development
- **SUPPLIER_MODE** env var: `mock` | `live` | `hybrid` (default: `mock`)
- **In-memory search cache** with configurable TTL
- **In-memory rate limiter** for /api/search
- **DB-backed search** when `USE_EXISTING_CATALOG_DB=true` and `CATALOG_SEARCH_SOURCE=existing-db` — no live supplier API call on every search when DB mode is active
- **OEM/OEN search** via `supplier_product_oems` table JOIN
- **Supplier provider mapping** — `supplier_products.supplier_name` contains product descriptions, not the actual supplier name; the real supplier comes from `provider_id` → `supplier_providers.name`

## Key Rules

- Supplier API credentials **must only** live in environment variables — never expose to browser
- Never expose raw supplier API responses to the browser — always normalize into internal DTOs
- If one supplier fails, search must still return results from other suppliers
- Product search must support partial failure
- Use mock supplier data until real API credentials are added
- Keep architecture ready for future: OEM/OEN matching, vehicle fitment, VIN/chassis search, plate search
- UI: professional automotive e-commerce — dark navy, white, blue accent, clean typography, trust-focused
- Admin routes are protected by HTTP Basic Auth via `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars
- Admin API routes under `/api/admin/` require admin auth
- If `ADMIN_PASSWORD` is not set, admin routes fail closed (401)
- KVKK consent is required before any personal data submission
- Customer PII must never be exposed without authentication
- Never log API keys or raw supplier payloads
- Cache only successful normalized results, never cache errors
- `DATABASE_URL` and `DIRECT_URL` must only exist in local `.env` or server environment — never commit to git
- Never expose `raw_payload` from `supplier_products` to the browser
- Never expose `raw_json` from `supplier_products` to the browser
- Product request `product_snapshot` must never contain `raw_json` or `raw_payload` fields
- Price/stock from catalog DB should be verified before commercial order confirmation
- Customer `product_requests` table stores request data; `supplier_product_id` links to catalog product; `product_snapshot` stores product info at request time as JSONB
- `supplier_products.supplier_name` is product description/name, not actual supplier name; real supplier comes from `provider_id` → `supplier_providers.name`

## File Conventions

- Pages: `src/app/<route>/page.tsx`
- API routes: `src/app/api/<route>/route.ts`
- Components: `src/components/<name>.tsx`
- Types: `src/types/index.ts` (business DTOs), `src/types/database.ts` (Supabase)
- Suppliers: `src/suppliers/`
- Utilities: `src/lib/utils.ts`
- Rate limiter: `src/lib/rate-limit.ts`
- Catalog DB client: `src/lib/catalog-db.ts`
- Catalog search: `src/lib/catalog-search.ts`
- Storefront constants: `src/lib/storefront.ts`
- Supabase clients: `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`
- Middleware: `src/middleware.ts` → `src/lib/admin-auth.ts` (admin auth + /api/admin/ protection)

## Commands

- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript check
- `npx tsx scripts/inspect-existing-supabase-catalog.ts` — inspect catalog DB schema and data

## Env Variables

- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — protect /admin and admin API routes
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase connection
- `DATABASE_URL` — Supabase connection pooler URL (server-side only, never expose to browser)
- `DIRECT_URL` — Supabase direct connection URL (server-side only, for schema inspection)
- `USE_EXISTING_CATALOG_DB` — `true` | `false` (default: `false`) — enable DB-backed search
- `CATALOG_SEARCH_SOURCE` — `mock` | `existing-db` (default: `mock`) — search source selection
- `SUPPLIER_CATALOG_TABLE` — table name for catalog search (default: `supplier_products`)
- `SUPPLIER_DB_SCHEMA` — schema for catalog table (default: `public`)
- `SEARCH_LIVE_FALLBACK_ENABLED` — `true` | `false` (default: `false`) — fallback to live API when DB search returns no results
- `SUPPLIER_MODE` — `mock` | `live` | `hybrid` (default: `mock`)
- `SUPPLIER_A_ENABLED` — `true` | `false` (default: `false`)
- `SUPPLIER_A_API_KEY` / `SUPPLIER_A_SECRET_KEY` / `SUPPLIER_A_BASE_URL` — Supplier A API credentials
- `SUPPLIER_A_TIMEOUT_MS` — Supplier A request timeout (default: `8000`)
- `SUPPLIER_A_USE_PROXY` — `true` | `false` (default: `false`) — route Supplier A requests through proxy
- `SUPPLIER_A_PROXY_URL` — proxy URL for Supplier A; only used if `SUPPLIER_A_USE_PROXY=true`
- `NODE_EXTRA_CA_CERTS` — path to extra CA certificates bundle (e.g. `/app/certs/sectigo-intermediate.pem` for Dinamik Oto)
- `SUPPLIER_B_API_KEY` / `SUPPLIER_B_BASE_URL` — Supplier B API credentials
- `SUPPLIER_C_API_KEY` / `SUPPLIER_C_BASE_URL` — Supplier C API credentials
- `SEARCH_CACHE_TTL_SECONDS` — Search cache TTL (default: `60`)
- `SEARCH_RATE_LIMIT_WINDOW_SECONDS` — Rate limit window (default: `60`)
- `SEARCH_RATE_LIMIT_MAX` — Max requests per window per IP (default: `30`)

## Search Behavior

When `USE_EXISTING_CATALOG_DB=true` and `CATALOG_SEARCH_SOURCE=existing-db`:

### SKU/OEM/Barcode-like Queries
When query looks like a product code (alphanumeric 4+ chars), search prioritizes exact matches:
1. Exact `supplier_sku` match
2. Exact `normalized_sku` match
3. Exact `barcode_1/2/3` match
4. Exact `oem_code` or `normalized_oem_code` match (via `supplier_product_oems`)
5. Fuzzy SKU/barcode/brand ILIKE
6. Fuzzy OEM ILIKE match
7. Name/description ILIKE fallback

### Free-text Queries
1. ILIKE across `supplier_brand`, `supplier_name`, `normalized_name`, `supplier_sku`, `normalized_sku`, barcodes
2. OEM ILIKE match (via EXISTS subquery on `supplier_product_oems`)
3. Results ranked by stock availability, price existence, brand relevance

### Filters (via query parameters)
- `supplier` — filter by provider name (via `supplier_providers`)
- `brand` — filter by `supplier_brand`
- `inStock=true/false` — filter by stock status
- `minPrice` / `maxPrice` — price range filter
- `sort` — relevance (default), in_stock_first, price_asc, price_desc, updated_desc

### Relevance Ranking
- SKU-like queries: exact SKU > prefix SKUs > others, then stock > no stock, priced > unpriced
- Free-text: stock > no stock, priced > unpriced, brand match priority, then updated_at

### Result Safety
- If DB results exist, they are returned with `dataSource: "existing-db"`
- If `SEARCH_LIVE_FALLBACK_ENABLED=true` and DB search returns no results, fallback to live supplier API
- `raw_json` is never returned to the browser — only normalized fields
- `supplier_product_oems` OEM codes are included in `oemNumbers` array

When `USE_EXISTING_CATALOG_DB=false` or `CATALOG_SEARCH_SOURCE=mock`:
- Preserves existing mock/live behavior (no DB queries)

## Supplier Mode Behavior

- **mock**: Only mock supplier adapter is used. No real API calls.
- **live**: Only real supplier adapters (A, B, C) are used. Mock is excluded.
- **hybrid**: Real adapters are included when enabled and configured; mock is always included as fallback.

## Database

- Schema: `supabase/migrations/001_initial_schema.sql`
- KVKK migration: `supabase/migrations/002_kvkk_consent.sql`
- Request statuses migration: `supabase/migrations/003_request_statuses.sql`
- Product request enhancements: `supabase/migrations/004_product_request_enhancements.sql`
- Run on Supabase dashboard or via `supabase` CLI
- **Do not run destructive migrations against the existing DB**
- Catalog DB uses `pg` driver for read-only queries against `supplier_products`

## Docker

- Local host port: 3001
- Container port: 3000
- All catalog DB env vars are passed through `docker-compose.yml`
- Real env values must exist only in local `.env` or server environment