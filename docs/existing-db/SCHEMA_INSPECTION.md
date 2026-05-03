# Existing Database Schema Inspection

**Inspection Date:** 2026-05-03
**Database:** Existing Supabase PostgreSQL (Shared Connection Pooler)
**Table:** `public.supplier_products`

## Table Structure

| Column | Data Type | Nullable | Default | Notes |
|--------|-----------|----------|---------|-------|
| `id` | integer | NO | `nextval('supplier_products_id_seq'::regclass)` | Primary key |
| `provider_id` | integer | NO | — | FK to `supplier_providers.id` |
| `supplier_product_key` | text | NO | — | Unique key per provider (e.g., "AISIN::AISIN WPZ-028V") |
| `supplier_sku` | text | NO | — | Product code (e.g., "AISIN WPZ-028V") |
| `supplier_brand` | text | YES | — | Brand name (e.g., "AISIN") |
| `supplier_name` | text | YES | — | Product description (NOT supplier name) |
| `normalized_sku` | text | YES | — | Normalized SKU for search |
| `normalized_name` | text | YES | — | Normalized name for search |
| `barcode_1` | text | YES | — | EAN barcode |
| `barcode_2` | text | YES | — | Secondary barcode |
| `barcode_3` | text | YES | — | Tertiary barcode |
| `supplier_price` | numeric | YES | — | Price in TRY |
| `supplier_stock_qty` | integer | NO | 0 | Stock quantity |
| `currency` | text | NO | 'TRY' | Currency code |
| `raw_json` | jsonb | NO | — | Raw supplier response (SENSITIVE) |
| `last_seen_at` | timestamp without time zone | NO | CURRENT_TIMESTAMP | Last sync time |
| `created_at` | timestamp without time zone | NO | CURRENT_TIMESTAMP | Record creation time |
| `updated_at` | timestamp without time zone | NO | CURRENT_TIMESTAMP | Last update time |
| `image_url` | text | YES | — | Product image URL |

## Indexes

The table has comprehensive indexes for search performance:

- `idx_supplier_products_search_trgm` — GIN trigram index on concatenated searchable text
- `supplier_products_supplier_sku_idx` — B-tree on `supplier_sku`
- `idx_supplier_products_supplier_sku_trgm` — GIN trigram on `supplier_sku`
- `supplier_products_pkey` — Unique on `id`
- `supplier_products_provider_product_key_key` — Unique on `(provider_id, supplier_product_key)`
- `supplier_products_provider_sku_key` — Unique on `(provider_id, supplier_sku)`
- `idx_supplier_products_provider_sku` — B-tree on `(provider_id, supplier_sku)`
- `idx_supplier_products_supplier_brand` — B-tree on `supplier_brand`
- `idx_supplier_products_provider_updated_at` — B-tree on `(provider_id, updated_at DESC)`
- `idx_supplier_products_provider_brand_updated_at` — B-tree on `(provider_id, supplier_brand, updated_at DESC)`
- `supplier_products_provider_id_updated_at_idx` — B-tree on `(provider_id, updated_at DESC)`
- `idx_supplier_products_sku_lower` — B-tree on `lower(supplier_sku)`

## Total Row Count

**390,993** products

## Supplier Providers (via `supplier_providers` table)

| provider_id | Name | Row Count |
|-------------|------|-----------|
| 2164 | Dinamik | 389,603 |
| 2165 | SETA | 1,390 |
| 2169 | ParcaTedarik | — (present but minimal) |

Note: Exact counts for ParcaTedarik may vary — run the inspection script for live counts.

## Detected Supplier Column

The `provider_id` column links to `supplier_providers.name` for the actual supplier name (Dinamik, SETA, ParcaTedarik).

The `supplier_name` column contains product descriptions, NOT the supplier/vendor name.

## Sample Data

Run `npx tsx scripts/inspect-existing-supabase-catalog.ts` for live samples. All `raw_json` fields are masked/redacted in the output.

## OEM Table: supplier_product_oems

**Total OEM rows:** 2,879
**Products with OEM data:** 1,394 (out of 390,993)

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | integer | NO | `nextval(...)` | Primary key |
| `provider_id` | integer | NO | — | FK to `supplier_providers.id` |
| `supplier_product_id` | integer | NO | — | FK to `supplier_products.id` |
| `oem_code` | text | NO | — | Original OEM number |
| `normalized_oem_code` | text | NO | — | Normalized OEM for search |
| `oem_brand` | text | YES | — | OEM brand |
| `source` | text | NO | 'API' | Data source (API, MANUAL) |
| `is_active` | boolean | NO | true | Active flag |
| `created_at` | timestamp | NO | CURRENT_TIMESTAMP | |
| `updated_at` | timestamp | NO | CURRENT_TIMESTAMP | |

### OEM Indexes

- `supplier_product_oems_pkey` — Unique btree on `id`
- `supplier_product_oems_provider_product_code_source_key` — Unique btree on `(provider_id, supplier_product_id, normalized_oem_code, source)`
- `idx_supplier_product_oems_normalized_oem_code` — B-tree on `normalized_oem_code`
- `idx_supplier_product_oems_provider_normalized_oem_code` — B-tree on `(provider_id, normalized_oem_code)`
- `idx_supplier_product_oems_supplier_product_id` — B-tree on `supplier_product_id`

## Product Statistics

- **With OEM:** 1,394 products
- **Without OEM:** 389,599 products
- **With price:** 378,622 products
- **Without price:** 12,371 products
- **With stock:** 190,290 products
- **Without stock:** 200,703 products

## Related Tables

The database contains additional tables that could support future features:
- `supplier_providers` — Provider/supplier names (columns: id, code, name, status, priority, schedule, base_url, config, last_sync_at, created_at, updated_at)
- `supplier_product_oems` — OEM number mappings (2,879 rows, linked via `supplier_product_id`)
- `supplier_part_mappings` — Part cross-references
- `supplier_brand_aliases` — Brand aliases
- `parts` — Normalized product catalog
- `part_brands` / `part_categories` — Brand and category data
- `part_oens` — OEM/OEN numbers
- `part_pricing_inventory` — Pricing and inventory
- `part_images` — Product images

## Connection

- **DATABASE_URL**: Supabase Shared Connection Pooler (pgbouncer)
- **DIRECT_URL**: Direct/shared pooler connection for schema inspection
- Both are server-side only — never exposed to the browser

## Security Notes

- `DATABASE_URL` and `DIRECT_URL` must only exist in local `.env` or server environment
- Never commit real credentials to git
- `raw_json` fields contain sensitive supplier response data
- The inspection script never prints credentials
- All API responses strip `raw_json` before sending to the browser