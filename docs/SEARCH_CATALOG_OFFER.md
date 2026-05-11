# Search: Catalog + Offer Strategy (v0.2.1 → v0.2.3)

## Overview

The search architecture uses a **catalog-first + offer-prioritized** PostgreSQL strategy as fallback, and **self-hosted Meilisearch** as the primary search engine when enabled.

### When `MEILI_ENABLED=true` (v0.2.3+)

1. Meilisearch handles all search queries (products index)
2. Products are indexed with availability status (PURCHASABLE, REQUEST_PRICE, OUT_OF_STOCK)
3. Broad and OEM queries complete in < 1s warm
4. PostgreSQL is the source of truth for pricing, stock, and product data
5. On Meili failure, falls back to PostgreSQL catalog+offer search

### When `MEILI_ENABLED=false` (v0.2.1 default)

1. All search goes through PostgreSQL catalog+offer search (`runCatalogOfferSearch()`)
2. No typo tolerance, limited faceted navigation
3. Broad queries like "Bosch" complete in < 2s using CTE-based ranking

## Meilisearch (Primary, v0.2.3+)

See `docs/SEARCH_MEILISEARCH_SELF_HOSTED.md` for full setup, configuration, and troubleshooting.

- Index: `products`
- Search attributes: title, brand, supplierSku, oemCodes, eanCodes, normalizedSearchText, categoryName, name
- Filterable: availabilityStatus, brand, categorySlug, providerName, hasPrice, hasStock, sourceType, brandId, categoryId
- Sortable: price, stockQty, updatedAt, rankScore
- Ranking: words, typo, proximity, attribute, sort, exactness
- Typo tolerance: oneTypo at 5 chars, twoTypos at 9 chars

## PostgreSQL Fallback

1. All known catalog parts remain visible for SEO and discovery
2. Products with supplier-backed price and stock are prioritized for purchase
3. Products without price show "Fiyat Al" (Request Price) CTA
4. Broad queries must complete under 2 seconds

## Why Meilisearch is Deferred

Meilisearch was disabled in v0.2.0 after discovering the Prisma fallback took ~135s for broad queries. A fast PostgreSQL search path replaces it, meeting the 2s target without additional infrastructure.

The Meilisearch integration code remains intact and can be re-enabled with `MEILI_ENABLED=true`.

## Search Architecture

When `MEILI_ENABLED` is not `true`, the `/api/search` route uses `runCatalogOfferSearch()`:

1. **Supplier-backed path**: Queries `supplier_products` with `supplier_part_mappings` using tiered CTE ranking
2. **Catalog-only path**: Queries `parts` table for products without approved supplier mappings (max 30 results)

### Ranking Priority

1. Exact supplier SKU (tier 0, score 100)
2. Exact OEM code (tier 0, score 90)
3. Exact EAN/barcode (tier 1, score 80)
4. Brand exact match (tier 2, score 50)
5. Name/SKU contains (tier 3, score 30)
6. OEM code contains (tier 3, score 25)

### Result Ordering

1. PURCHASABLE products (has price + stock)
2. OUT_OF_STOCK products (has price, no stock)
3. REQUEST_PRICE products (catalog-only, no price)

## Availability Status Model

| Status | Description | CTA (TR) | CTA (EN) |
|--------|-------------|----------|----------|
| `PURCHASABLE` | Has real price and stock | Sepete Ekle | Add to Cart |
| `REQUEST_PRICE` | No price available | Fiyat Al | Request Price |
| `VERIFY_FITMENT` | Compatibility uncertain | Uygunluk Sor | Verify Fitment |
| `OUT_OF_STOCK` | Has price, no stock | Stok Gelince Haber Ver | Notify When Available |

## Response Shape

The search response includes standard `hits` (SearchHit[]) plus:

- `products`: CatalogOfferProduct[] with availability data
- `purchasableCount`, `requestPriceCount`, etc.
- `dataSource: "postgres_catalog_offer_search"`
- `liveFallbackUsed: false`
- `durationMs`

## Performance Targets

- `/api/search?q=Bosch` < 2 seconds
- Max 60 results per page
- Max 30 catalog-only results per query

## Required Indexes

See `scripts/search-indexes.sql` for pg_trgm and composite index recommendations.

## Environment Variables

- `MEILI_ENABLED=false` — Must be false until Meilisearch is deployed
- `NEXT_PUBLIC_ALLOW_INDEXING=true` — Must be true for SEO

## Limitations

- No typo tolerance (PostgreSQL ILIKE instead of fuzzy search)
- Limited faceted navigation in fallback mode
- No real-time stock verification during search

## Next Steps (v0.2.4+)

- Full request price flow
- FITMENT_CHECK request type
- Live stock check before add-to-cart
- Admin sync dashboard
- Meilisearch incremental indexing on supplier sync