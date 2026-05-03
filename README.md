# getirbakim.com

Açık kaynak otomotiv yedek parça e-commerce platformu. Birden fazla tedarikçiden anlık fiyat ve stok karşılaştırması.

## Tech Stack

- **Next.js 16** (App Router, Server Components)
- **TypeScript**
- **Tailwind CSS v4**
- **Supabase** (Database, Auth, Storage)
- **PostgreSQL (`pg` driver)** for existing catalog DB queries
- **Docker** (Local development & VPS deployment)

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Installation

```bash
npm install
```

### Environment Setup

```bash
cp .env.example .env.local
```

Edit `.env.local` with your Supabase credentials. The app works with mock supplier data by default — no real API keys required for local development.

To enable DB-backed search with the existing Supabase catalog:
```
DATABASE_URL=your-supabase-pooler-url
DIRECT_URL=your-supabase-direct-url
USE_EXISTING_CATALOG_DB=true
CATALOG_SEARCH_SOURCE=existing-db
```

Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` to protect admin routes. If these are not set, admin routes will be inaccessible (fail closed).

### Supplier Mode

The `SUPPLIER_MODE` environment variable controls which supplier adapters are active:

| Mode | Behavior |
|------|----------|
| `mock` (default) | Only mock supplier data. No real API calls. |
| `live` | Only real supplier adapters (A, B, C). Mock is excluded. |
| `hybrid` | Real adapters when enabled and configured, mock as fallback. |

### Catalog DB Search

When `USE_EXISTING_CATALOG_DB=true` and `CATALOG_SEARCH_SOURCE=existing-db`:
1. Product search queries the `supplier_products` table in the existing Supabase DB
2. Supplier identity is resolved via `provider_id` → `supplier_providers.name` (not from `supplier_products.supplier_name`, which contains product descriptions)
3. Results are normalized into the standard product DTO
4. If DB results exist, they are returned with `dataSource: "existing-db"`
5. If `SEARCH_LIVE_FALLBACK_ENABLED=true` and DB search returns no results, fallback to live supplier API
6. `raw_payload` is never returned to the browser — only normalized fields

Price and stock info from the catalog DB should be verified before commercial order confirmation.

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Note:** `npm run dev` runs on port 3000 by default. Docker Compose maps the app to **port 3001** to avoid conflicts.

### Build

```bash
npm run build
```

### Inspect Catalog DB

```bash
npx tsx scripts/inspect-existing-supabase-catalog.ts
```

This read-only script inspects the `supplier_products` table schema, row counts, and supplier distribution. It never prints credentials.

## Deployment

### Local / VPS with Docker Compose

1. Copy the env file and fill in values:

```bash
cp .env.example .env.local
# Edit .env.local with real values
```

2. Build and run:

```bash
docker compose up --build -d
```

The app will be available at `http://localhost:3001`.

To rebuild after changes:

```bash
docker compose build --no-cache && docker compose up -d
```

**Important:** On a production VPS (e.g. Contabo), you must set:
- `NEXT_PUBLIC_SITE_URL` — site URL for metadata (default: `http://localhost:3001`)
- `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — your Supabase anon key
- `DATABASE_URL` — Supabase connection pooler URL (server-side only)
- `DIRECT_URL` — Supabase direct connection URL (server-side only)
- `ADMIN_USERNAME` — choose a strong admin username
- `ADMIN_PASSWORD` — choose a strong admin password

**Never commit real secrets to git.** `DATABASE_URL`, `DIRECT_URL`, and API keys must only exist in local `.env` or server environment.

### Reverse Proxy (Contabo VPS)

For production, use a reverse proxy (Nginx/Caddy) in front of the Docker container:

```nginx
server {
    listen 80;
    server_name getirbakim.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name getirbakim.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Admin Access

Admin pages (`/admin/*`) and admin API endpoints (`/api/admin/*`, `GET/PATCH/DELETE /api/requests`) are protected by HTTP Basic Auth.

- Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables
- If either is missing, admin routes return 401 (fail closed)
- When visiting `/admin/*` in a browser, a login form is shown
- For API access, use `Authorization: Basic <base64(user:pass)>` header

## Search Cache & Rate Limiting

- **Search cache**: In-memory TTL cache for identical search queries. Default TTL: 60 seconds (`SEARCH_CACHE_TTL_SECONDS`). Only successful results are cached. Redis can be added later for multi-instance caching.
- **Rate limiting**: In-memory per-IP rate limiting for `/api/search`. Default: 30 requests per 60 seconds per IP (`SEARCH_RATE_LIMIT_MAX`, `SEARCH_RATE_LIMIT_WINDOW_SECONDS`). Respects `x-forwarded-for` header. Returns 429 with a friendly Turkish message when exceeded.

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/                # API routes (search, products, requests, featured, supplier-health, admin)
│   ├── admin/              # Admin pages (auth-protected)
│   │   ├── existing-db/    # Catalog DB dashboard (v0.3.0)
│   │   ├── requests/       # Request list with status management
│   │   └── suppliers/      # Health dashboard & API logs
│   ├── products/[id]/      # Product detail
│   ├── search/             # Search results
│   ├── request/            # Product request form
│   ├── privacy/            # Legal pages
│   ├── kvkk/
│   ├── returns/
│   └── distance-sales/
├── components/             # React components
│   ├── header.tsx          # 3-level e-commerce header
│   ├── footer.tsx          # Professional footer with columns
│   ├── hero-section.tsx    # Homepage hero with search & vehicle selector
│   ├── trust-benefits.tsx  # Trust/service benefit icons
│   ├── category-grid.tsx   # Automotive category icon grid
│   ├── featured-products.tsx # Featured products with tabs
│   ├── deal-zone.tsx      # Promotional deal zone
│   ├── search-bar.tsx      # Search bar (hero/md/lg sizes)
│   ├── product-card.tsx    # Product card with image, badges, CTAs
│   └── offer-table.tsx     # Offer comparison table
├── lib/
│   ├── admin-auth.ts       # Admin HTTP Basic Auth
│   ├── catalog-db.ts       # Catalog DB connection pool (pg)
│   ├── catalog-search.ts   # Catalog DB search service (v0.3.0)
│   ├── storefront.ts       # Storefront constants & category data (v0.3.1)
│   ├── rate-limit.ts       # In-memory per-IP rate limiter
│   ├── supabase/           # Supabase client utilities
│   └── utils.ts            # Shared utilities
├── suppliers/              # Supplier adapter architecture
│   ├── index.ts            # Adapter registry (mode-aware)
│   ├── config.ts           # Supplier mode config (SUPPLIER_MODE)
│   ├── types.ts            # Adapter interface
│   ├── search.ts           # Search aggregation + caching
│   ├── cache.ts            # In-memory TTL search cache
│   ├── logger.ts           # Supplier API call logging (memory + Supabase)
│   ├── mock.ts             # Mock supplier adapter
│   ├── supplier-a.ts       # Supplier A adapter (env-driven)
│   ├── supplier-b.ts       # Supplier B adapter
│   └── supplier-c.ts       # Supplier C adapter
├── middleware.ts           # Next.js middleware (admin auth)
└── types/
    ├── index.ts             # Business DTOs
    └── database.ts          # Supabase generated types
```

## Architecture

### Supplier Adapter Pattern

Each supplier implements a common `SupplierAdapter` interface:

- `search(query)` — search products across supplier
- `getProduct(productId)` — get product details
- `checkHealth()` — verify supplier API is reachable

The adapter registry (`src/suppliers/index.ts`) respects `SUPPLIER_MODE`:
- `mock`: Only `MockSupplierAdapter` is activated
- `live`: Only real adapters with configured credentials are activated
- `hybrid`: Real adapters when configured, mock always included as fallback

Each real adapter checks `apiKey` and `baseUrl` before making API calls. If credentials are missing, the adapter returns an empty result with an error message (no crash).

### Search Cache (v0.2.0)

- In-memory TTL cache for search results
- Cache key includes query and supplier mode
- Only successful results are cached (errors are never cached)
- Default TTL: 60 seconds, configurable via `SEARCH_CACHE_TTL_SECONDS`
- Simple implementation; Redis can replace this for multi-instance deployments

### Rate Limiting (v0.2.0)

- In-memory per-IP rate limiting for `/api/search`
- Respects `x-forwarded-for` and `x-real-ip` headers
- Default: 30 requests / 60 seconds per IP
- Returns 429 with Turkish error message

### Key Principles

- **Supplier API credentials** only in environment variables (never exposed to browser)
- **Normalized DTOs** — raw supplier responses never reach the client
- **Partial failure tolerance** — if one supplier fails, others still return results
- **Mock adapter** — works without any real API credentials for local development
- **Admin auth** — HTTP Basic Auth via env vars, fail-closed if not configured
- **KVKK consent** — required before any personal data submission

## Database

Run the Supabase migrations:

```bash
# Initial schema
supabase/migrations/001_initial_schema.sql

# KVKK consent fields
supabase/migrations/002_kvkk_consent.sql

# Request statuses (quoted, closed)
supabase/migrations/003_request_statuses.sql
```

See `supabase/migrations/` for the full schema.

## License

MIT