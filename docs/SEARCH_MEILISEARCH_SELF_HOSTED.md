# Self-Hosted Meilisearch Search Engine

## Why Self-Hosted Meilisearch

Meilisearch Cloud is not affordable for this project's current stage. Self-hosted Meilisearch on the existing Contabo VPS (via Docker) provides:

- Fast full-text search with typo tolerance
- Broad queries like "Bosch" return in < 1s warm (vs 135s cold with Prisma fallback)
- OEM/SKU/EAN code lookups are instant
- PostgreSQL remains the source of truth for pricing, stock, and product data

## Architecture

```
Client → /api/search → MEILI_ENABLED=true?
                           ├── Yes → Meilisearch (products index)
                           │          ├── canonical_part documents
                           │          ├── supplier_offer documents (mapped)
                           │          ├── orphan_supplier_product documents (unmapped)
                           │          └── On error → PostgreSQL fallback
                           └── No  → PostgreSQL catalog+offer search
```

- PostgreSQL = source of truth for pricing, stock, product data
- Meilisearch = fast search index with canonical-parts-first strategy
- Products with price/stock are prioritized (PURCHASABLE)
- Products without price remain visible as REQUEST_PRICE
- Canonical parts are indexed with full enrichment (OEM, EAN, cross-refs, offers, fitment)
- Supplier products with approved mappings merge into canonical part documents
- Orphan supplier products are indexed separately with `documentType: orphan_supplier_product`
- Turkish/English synonyms expand search coverage

### Document Types

| Document Type | ID Format | Description |
|---|---|---|
| `canonical_part` | `part_<partId>` | Canonical catalog part with supplier offer enrichment |
| `supplier_offer` | `part_<partId>` | Mapped supplier product merged into canonical part doc |
| `orphan_supplier_product` | `sp_<supplierProductId>` | Unmapped supplier product indexed independently |

### Index Fields (v0.2.5)

**Searchable**: title, titleTr, brand, categoryName, categoryNameTr, supplierSku, normalizedSku, oemCodes, eanCodes, crossReferences, referenceNumbers, exactCodes, normalizedSearchText, searchKeywords, synonymsText, vehicleBrandNames, vehicleModelNames, vehicleTypeNames, engineCodes, name

**Filterable**: documentType, availabilityStatus, brand, categorySlug, categoryId, providerCode, providerName, hasPrice, hasStock, hasSupplierOffer, matchStatus, vehicleBrandNames, vehicleModelNames, brandId, sourceType

**Sortable**: rankScore, price, stockQty, updatedAt, offerCount, fitmentCount

**Synonyms**: Turkish/English automotive term mappings (fuel filter ↔ yakıt filtresi, brake pad ↔ fren balatası, etc.)

## Local Docker Setup

1. Ensure `.env` has:
```
MEILI_ENABLED=true
MEILI_HOST=http://meilisearch:7700    # Inside Docker network
MEILI_MASTER_KEY=local-dev-master-key # Change for production
MEILI_INDEX_PRODUCTS=products
```

2. Start services:
```bash
docker compose -f docker-compose.local.yml down --remove-orphans
docker compose --env-file .env -f docker-compose.local.yml up -d --build
```

3. Verify Meilisearch is healthy:
```bash
docker compose -f docker-compose.local.yml ps
curl -s http://127.0.0.1:7700/health || echo "Meili not reachable"
```

4. Run index setup:
```bash
docker compose -f docker-compose.local.yml exec app bun run search:setup
```

5. Run reindex:
```bash
docker compose -f docker-compose.local.yml exec app bun run search:reindex
```

6. Test search:
```bash
curl -s 'http://localhost:3001/api/search?q=Bosch' | jq '.dataSource, .liveFallbackUsed, .durationMs, (.products | length)'
```

## VPS Docker Setup

1. Add to `.env.production`:
```
MEILI_ENABLED=true
MEILI_HOST=http://meilisearch:7700
MEILI_MASTER_KEY=<strong-random-key>
MEILI_INDEX_PRODUCTS=products
```

2. Deploy:
```bash
NEXT_PUBLIC_BUILD_VERSION=v0.2.3 docker compose --env-file .env.production up -d --build
```

3. Setup and reindex:
```bash
docker compose exec app bun run search:setup
docker compose exec app bun run search:reindex
```

## Required Env Vars

| Variable | Required | Description |
|----------|----------|-------------|
| `MEILI_ENABLED` | Yes | `true` or `false`. Keep `false` until index is built. |
| `MEILI_HOST` | Yes | Meilisearch host URL. Inside Docker: `http://meilisearch:7700`. Outside: `http://127.0.0.1:7700`. |
| `MEILI_MASTER_KEY` | Yes | Server-only admin key. **Never expose to browser.** |
| `MEILI_INDEX_PRODUCTS` | No | Index name, defaults to `products`. |

## Server-Only Key Warning

- `MEILI_MASTER_KEY` is server-only. It must NEVER be exposed to the browser.
- Do NOT set `NEXT_PUBLIC_MEILI_HOST` or `NEXT_PUBLIC_MEILI_SEARCH_KEY` unless the frontend directly connects to Meilisearch (not recommended).
- Prefer: frontend → /api/search → server-side Meili.

## Setup Command

```bash
bun run search:setup
# or inside Docker:
docker compose -f docker-compose.local.yml exec app bun run search:setup
```

The app container includes Bun, so `bun run search:setup` and `bun run search:reindex` work inside the container.

Configures: searchable attributes, filterable attributes, sortable attributes, ranking rules, typo tolerance, pagination limits.

## Reindex Command

```bash
bun run search:reindex
# or inside Docker:
docker compose -f docker-compose.local.yml exec app bun run search:reindex
```

Options:
- `MEILI_REINDEX_CLEAR=true` — delete all documents before reindexing
- `MEILI_REINDEX_BATCH_SIZE=500` — batch size (default: 500)
- `MEILI_REINDEX_MAX_PARTS=0` — max canonical part documents (0 = unlimited)
- `MEILI_REINDEX_MAX_ORPHAN_SUPPLIERS=0` — max orphan supplier documents (0 = unlimited)
- `MEILI_REINDEX_INCLUDE_FITMENT=false` — include vehicle fitment data (default: false)
- `MEILI_REINDEX_FITMENT_BATCH_SIZE=100` — fitment enrichment batch size (default: 100)
- `MEILI_REINDEX_FITMENT_LIMIT_PER_PART=50` — max fitment entries per part (default: 50)
- `MEILI_REINDEX_FITMENT_TIMEOUT_SAFE=true` — continue on batch failure (default: true)

### Reindex Phases

1. **Phase 1 - Supplier-backed**: Builds documents from `supplier_products` with approved `supplier_part_mappings` (enriched with canonical part data)
2. **Phase 2 - Catalog-only**: Builds documents from `parts` without approved mappings. Parts with OEM codes are prioritized over those without, ensuring code-bearing parts are indexed within the 30k limit.
3. **Phase 2b - Fitment enrichment** (optional): Enriches **both supplier-backed and catalog-only documents** with vehicle fitment data in configurable batches. Disabled by default (`MEILI_REINDEX_INCLUDE_FITMENT=false`).
4. **Phase 3 - Orphan suppliers**: Builds documents from `supplier_products` with no mapping and no offer. Products with OEM codes or barcodes are prioritized, ensuring code-bearing orphan products are indexed within the 10k limit.

### Reindex Output

```
=== Summary ===
canonicalPartDocuments: <count>
orphanSupplierDocuments: <count>
purchasableCount: <count>
requestPriceCount: <count>
outOfStockCount: <count>
mappedSupplierProducts: <count>
unmappedSupplierProducts: <count>
totalDocuments: <count>
```

## Smoke Tests

After setup and reindex:

```bash
# Health check
curl -s http://localhost:3001/api/health | jq '.checks.meilisearch'

# Broad query
curl -s 'http://localhost:3001/api/search?q=Bosch' | jq '.dataSource, .liveFallbackUsed, .durationMs, (.products | length)'

# OEM code lookup
curl -s 'http://localhost:3001/api/search?q=0445110376' | jq '.dataSource, .durationMs, (.products | length)'

# Category page
curl -I http://localhost:3001/en/filters
curl -I http://localhost:3001/en/fuel-filter
```

Expected:
- `source/dataSource: "meilisearch"`
- `liveFallbackUsed: false`
- Broad query < 1s warm
- OEM query < 1s warm
- Canonical parts appear
- Purchasable products have `hasPrice: true, hasStock: true`
- Request-price products remain visible
- Orphan supplier products appear only when no canonical match exists
- Turkish/English terms return useful results (`yakıt filtresi` matches `fuel filter`)
- Exact OEM/EAN/SKU searches are fast

## Fallback Behavior

When `MEILI_ENABLED=true`:
- Search hits Meilisearch first
- On Meili error/unavailable, falls back to PostgreSQL catalog+offer search
- Response includes `meiliFallbackReason: 'meili_unavailable'` and `liveFallbackUsed: true`
- `source: "postgres_catalog_offer_search"` in fallback

When `MEILI_ENABLED=false` (or not set):
- Uses PostgreSQL catalog+offer search directly
- `source: "postgres_catalog_offer_search"`
- `degraded: true`
- `liveFallbackUsed: false`

## Backup and Volume Note

Meilisearch stores data in the `meili_data` (production) or `meili_data_local` (local) Docker volume. This volume persists across container restarts. To back up:

```bash
docker compose -f docker-compose.local.yml exec meilisearch ls /meili_data
```

The master key is stored in the container environment, not in the data directory. If you change `MEILI_MASTER_KEY`, you must delete the volume and reindex.

## Security Note

- Port 7700 is bound to `127.0.0.1` only — not publicly accessible
- `MEILI_MASTER_KEY` is server-only. Do NOT expose to browser.
- The `/api/search` route uses the master key server-side, never exposing it to the browser
- The internal health/setup/reindex endpoints require `CRON_SECRET` authorization
- The search document builder does not import `server-only`, so reindex scripts can run both on the host and inside the Docker container

## Troubleshooting

| Problem | Check | Fix |
|---------|-------|-----|
| `MEILI_ENABLED=false` | `/api/health` → `meilisearch: disabled` | Set `MEILI_ENABLED=true` in `.env` |
| Meili down | `/api/health` → `meilisearch: unreachable` | Check Docker container: `docker compose ps` |
| Master key invalid | Setup/reindex fail with 401 | Ensure `MEILI_MASTER_KEY` matches in `.env` and container |
| Index empty | `/api/internal/search/health` → `documentCount: 0` | Run `bun run search:reindex` |
| Wrong `MEILI_HOST` inside Docker | App logs show `ECONNREFUSED` | Inside Docker: `http://meilisearch:7700`. Outside: `http://127.0.0.1:7700` |
| Fallback too slow | Broad queries take > 2s | Reindex and check Meili health |
| Search returns `postgres_catalog_offer_search` | `MEILI_ENABLED` not set or `false` | Set `MEILI_ENABLED=true` and restart |