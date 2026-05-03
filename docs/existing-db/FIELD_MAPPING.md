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

### Search Strategy

The catalog search covers these columns with ILIKE:
- `supplier_sku` — exact/partial stock code
- `supplier_name` — product description
- `supplier_brand` — brand name
- `normalized_sku` — normalized SKU
- `normalized_name` — normalized product name
- `barcode_1` / `barcode_2` / `barcode_3` — barcode search
- `raw_json` — full JSON ILIKE (fallback)

A GIN trigram index (`idx_supplier_products_search_trgm`) exists for full-text search performance.

## Security

- `raw_json` is never sent to the browser
- Only normalized fields are returned in API responses
- DB credentials are never exposed to the client
- The search service uses parameterized queries to prevent SQL injection
- `provider_id` → provider name lookup is cached per request