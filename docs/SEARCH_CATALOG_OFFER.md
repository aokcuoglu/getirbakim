# Search: Catalog + Offer Strategy (v0.2.1 → v0.2.4)

## Overview

The search architecture uses a **canonical-parts-first + supplier-offer-enriched** strategy, with Meilisearch as the primary search engine when enabled, and PostgreSQL catalog+offer search as fallback.

### When `MEILI_ENABLED=true` (v0.2.4+)

1. Meilisearch handles all search queries (products index)
2. Documents are organized as **canonical_part**, **supplier_offer**, and **orphan_supplier_product**
3. Canonical parts include full enrichment: OEM codes, EAN codes, cross-references, supplier offers, vehicle fitment
4. Orphan supplier products are indexed separately until matched to canonical parts
5. Turkish/English synonyms expand search coverage
6. PostgreSQL remains the source of truth for pricing, stock, and product data
7. On Meili failure, falls back to PostgreSQL catalog+offer search

### When `MEILI_ENABLED=false` (v0.2.1 default)

1. All search goes through PostgreSQL catalog+offer search (`runCatalogOfferSearch()`)
2. No typo tolerance, limited faceted navigation
3. Broad queries like "Bosch" complete in < 2s using CTE-based ranking

## Meilisearch (Primary, v0.2.4+)

See `docs/SEARCH_MEILISEARCH_SELF_HOSTED.md` for full setup, configuration, and troubleshooting.

- Index: `products`
- Document types: `canonical_part`, `supplier_offer`, `orphan_supplier_product`
- Search attributes: title, titleTr, brand, categoryName, categoryNameTr, supplierSku, oemCodes, eanCodes, crossReferences, referenceNumbers, normalizedSearchText, searchKeywords, synonymsText, vehicleBrandNames, vehicleModelNames, vehicleTypeNames, engineCodes, name
- Filterable: documentType, availabilityStatus, brand, categorySlug, categoryId, providerCode, providerName, hasPrice, hasStock, hasSupplierOffer, matchStatus, vehicleBrandNames, vehicleModelNames, brandId, sourceType
- Sortable: rankScore, price, stockQty, updatedAt, offerCount, fitmentCount
- Synonyms: Turkish/English automotive term mappings

## Supplier Product Matching

See `docs/SUPPLIER_PART_MATCHING.md` for full matching strategy, confidence scores, and auto-approve rules.

Key principles:
- `parts` is the canonical catalog
- Supplier products enrich and sell canonical parts when matched
- Orphan supplier products remain searchable until matched
- Low-confidence matches require manual review

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

## Next Steps (v0.2.5+)

- Admin mapping workbench for candidate review
- Incremental Meilisearch indexing on supplier sync
- Live stock check before add-to-cart
- Full request price flow