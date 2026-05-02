# Release Notes — v0.2.0 Real Supplier API Integration Foundation

**Release Date:** 2025-05-01

## Overview

v0.2.0 prepares the platform for real supplier API integration. This release focuses on Supplier A adapter foundation, supplier mode configuration, search caching, rate limiting, admin supplier log visibility, and UI trust signals.

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
- Protected by admin auth via `src/proxy.ts`

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
- Supplier A adapter is structured for integration but requires actual API documentation to map endpoints

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