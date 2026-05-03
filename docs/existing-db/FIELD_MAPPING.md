# Field Mapping: supplier_products → Normalized Product DTO

This document maps the existing `supplier_products` table fields to the getirbakim normalized product DTO used in the frontend.

## Source Table: `public.supplier_products`

**Inspected on:** 2026-05-03
**Total rows:** 390,993

### Supplier Providers (via `supplier_providers` table)

| provider_id | Name |
|-------------|------|
| 2164 | Dinamik |
| 2165 | SETA |
| 2169 | ParcaTedarik |

### Direct Column Mapping

| DB Column | Type | DTO Field | Mapping Status | Notes |
|-----------|------|-----------|----------------|-------|
| `id` | integer | `id` (`db-{id}`) | **VERIFIED** | Integer PK, prefixed with `db-` |
| `provider_id` | integer | `supplierName` (via lookup) | **VERIFIED** | FK to `supplier_providers.id` → Dinamik/SETA/ParcaTedarik |
| `supplier_product_key` | text | — | **VERIFIED** | Unique key per provider (e.g., "AISIN::AISIN WPZ-028V") |
| `supplier_sku` | text | `supplierSku` / `supplierProductCode` | **VERIFIED** | Product code (e.g., "AISIN WPZ-028V") |
| `supplier_brand` | text | `brand` | **VERIFIED** | Brand name (e.g., "AISIN") |
| `supplier_name` | text | `name` | **VERIFIED** | Product description (NOT supplier name!) |
| `normalized_sku` | text | — | **VERIFIED** | Normalized SKU for search (e.g., "AISINWPZ028V") |
| `normalized_name` | text | — | **VERIFIED** | Normalized name for search |
| `barcode_1` | text | — | **VERIFIED** | EAN barcode |
| `barcode_2` | text | — | **VERIFIED** | Secondary barcode |
| `barcode_3` | text | — | **VERIFIED** | Tertiary barcode |
| `supplier_price` | numeric | `price` | **VERIFIED** | Direct price column |
| `supplier_stock_qty` | integer | `stockQuantity` | **VERIFIED** | Stock quantity (0 = unavailable) |
| `currency` | text | `currency` | **VERIFIED** | Currency code, default 'TRY' |
| `image_url` | text | `imageUrl` | **VERIFIED** | Direct image URL column |
| `raw_json` | jsonb | — | **SENSITIVE** | Never exposed to browser |
| `last_seen_at` | timestamp | `lastCheckedAt` | **VERIFIED** | Last sync time |
| `created_at` | timestamp | — | **VERIFIED** | Record creation time |
| `updated_at` | timestamp | `lastCheckedAt` (fallback) | **VERIFIED** | Last update time |

### Computed/Default Mapping

| DTO Field | Source | Mapping Status | Notes |
|-----------|--------|----------------|-------|
| `id` | `db-{supplier_products.id}` | **VERIFIED** | Prefixed to distinguish from live products |
| `name` | `supplier_name` | **VERIFIED** | Product description |
| `brand` | `supplier_brand` | **VERIFIED** | |
| `category` | null | **MISSING** | No category column in table |
| `description` | null | **MISSING** | No description column in table |
| `supplierName` | `supplier_providers.name` (via `provider_id`) | **VERIFIED** | Dinamik/SETA/ParcaTedarik |
| `supplierSku` | `supplier_sku` | **VERIFIED** | |
| `price` | `supplier_price` | **VERIFIED** | Direct numeric column |
| `currency` | `currency` | **VERIFIED** | Always 'TRY' |
| `stockQuantity` | `supplier_stock_qty` | **VERIFIED** | Integer, 0 = unavailable |
| `imageUrl` | `image_url` | **VERIFIED** | Direct column |
| `oemNumbers` | — | **MISSING** | Not in supplier_products directly; may be in `supplier_product_oems` table |
| `dataSource` | Hard-coded `"existing-db"` | **VERIFIED** | |
| `lastCheckedAt` | `updated_at` / `last_seen_at` | **VERIFIED** | |

### Related Tables

The DB also contains these related tables that could be used for future enhancements:

- `supplier_providers` — Supplier/provider names (Dinamik, SETA, ParcaTedarik)
- `supplier_product_oems` — OEM number mappings
- `supplier_part_mappings` — Part mapping cross-references
- `supplier_brand_aliases` — Brand name aliases
- `parts` — Normalized parts catalog
- `part_brands` — Brand data
- `part_categories` — Category data
- `part_oens` — OEM/OEN numbers
- `part_pricing_inventory` — Pricing and inventory
- `part_images` — Product images

### OEM Table: supplier_product_oems

| OEM Column | Type | DTO Field | Mapping Status | Notes |
|-----------|------|-----------|----------------|-------|
| `id` | integer | — | — | Primary key |
| `provider_id` | integer | — | — | FK to supplier_providers |
| `supplier_product_id` | integer | — | — | FK to supplier_products.id |
| `oem_code` | text | `oemNumbers[]` | **VERIFIED** | Original OEM number |
| `normalized_oem_code` | text | — | **VERIFIED** | Normalized for search |
| `oem_brand` | text | — | **VERIFIED** | OEM brand association |
| `source` | text | — | — | Data source (API/MANUAL) |
| `is_active` | boolean | — | — | Only active OEMs are returned |

### Search Strategy

The catalog search covers these columns:

**SKU/OEM/barcode-like queries (prioritized exact matches):**
1. Exact `supplier_sku` match
2. Exact `normalized_sku` match
3. Exact `barcode_1/2/3` match
4. Exact `oem_code` or `normalized_oem_code` match (via JOIN)
5. Fuzzy ILIKE across `supplier_sku`, `normalized_sku`, `barcode_1/2/3`, `supplier_brand`
6. Fuzzy OEM ILIKE match
7. Name/description ILIKE fallback

**Free-text queries:**
1. ILIKE across `supplier_brand`, `supplier_name`, `normalized_name`, `supplier_sku`, `normalized_sku`, `barcode_1/2/3`
2. OEM ILIKE match (via EXISTS subquery)

**Filters supported:**
- `supplier` — filter by provider name (via `supplier_providers`)
- `brand` — filter by `supplier_brand`
- `inStock` — filter by `supplier_stock_qty > 0`
- `minPrice` / `maxPrice` — filter by `supplier_price` range
- `sort` — relevance, in_stock_first, price_asc, price_desc, updated_desc

**Relevance ranking (default):**
- SKU-like queries: exact SKU > prefix SKUs > others, then stock available > no stock, priced > unpriced
- Free-text: stock available > no stock, priced > unpriced, brand match priority, then updated_at

A GIN trigram index (`idx_supplier_products_search_trgm`) exists for full-text search performance.

## Security

- `raw_json` is never sent to the browser
- Only normalized fields are returned in API responses
- DB credentials are never exposed to the client
- The search service uses parameterized queries to prevent SQL injection
- `provider_id` → provider name lookup is cached per request