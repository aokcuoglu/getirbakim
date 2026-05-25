# Dinamik ParçaTedarik Model Matching Admin

## Purpose

This module matches Dinamik supplier products to ParçaTedarik catalog products using barcode-to-model matching. The goal is to bridge Dinamik price/stock data to canonical `public.parts` through the ParçaTedarik reference system.

## Architecture

```
Dinamik products (price/stock)
  → barcode_1/2/3 normalized
    → ParçaTedarik normalized_model match
      → ParçaTedarik ref_no tokens
        → public.parts (OEM/EAN/cross-reference/part_no)
          → public.supplier_part_mappings
          → public.part_supplier_offers
```

## Matching Logic

### Step 1: Barcode → Model Match

1. **barcode_1 exact match**: Dinamik `barcode_1` normalized = ParçaTedarik `normalized_model` → confidence 0.98, reason `BARCODE_1_MODEL_EXACT`
2. **barcode_2 exact match**: confidence 0.96, reason `BARCODE_2_MODEL_EXACT`
3. **barcode_3 exact match**: confidence 0.94, reason `BARCODE_3_MODEL_EXACT`
4. **Brand match boost**: If Dinamik brand matches ParçaTedarik manufacturer → +0.01 confidence

### Step 2: Ambiguity Detection

- If exactly one ParçaTedarik product matches → status `CANDIDATE`
- If multiple ParçaTedarik products match the same barcode → status `NEEDS_REVIEW`, reason `MULTIPLE_PARCA_MODEL_MATCHES`

### Step 3: Approval → Part Resolution

When a match is approved, the ParçaTedarik `ref_no` tokens are resolved against `public.parts`:

| Match Type | Source Table | Field | Confidence |
|---|---|---|---|
| `OEM_MATCH` | `part_oens` | `code` | 0.98 |
| `EAN_MATCH` | `part_eans` | `code` | 0.96 |
| `PART_NO_MATCH` | `parts` | `part_no` | 0.90 |
| `CROSS_REFERENCE_MATCH` | `part_cross_references` | `article_number` | 0.88 |

- Exactly one confident candidate → auto-creates `supplier_part_mappings` and `part_supplier_offers`
- Ambiguous candidates → stays `NEEDS_REVIEW`

## Confidence Rules

| Match Path | Base Confidence | With Brand Boost |
|---|---|---|
| barcode_1 → model exact | 0.98 | 0.99 |
| barcode_2 → model exact | 0.96 | 0.97 |
| barcode_3 → model exact | 0.94 | 0.95 |
| Multiple PT matches | (base) | (+0.01, capped 0.99) |

## Admin Workflow

### Access
- URL: `/admin/supplier-matching/dinamik-parcatedarik`
- Admin only, protected by `requireAdminAuth`
- Supplier users must not access

### Matching Flow
1. Run candidate generation (default DRY_RUN)
2. Review candidates in table
3. Approve, reject, or mark for review
4. Bulk approve high-confidence unique matches

### Candidate Generation Commands
```bash
# Dry run
DRY_RUN=true bun scripts/generate-dinamik-parcatedarik-model-matches.ts

# Apply
APPLY=true bun scripts/generate-dinamik-parcatedarik-model-matches.ts

# With limits
APPLY=true LIMIT=500 bun scripts/generate-dinamik-parcatedarik-model-matches.ts
```

### API Routes

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/supplier-matching/dinamik-parcatedarik` | List matches with filters, pagination, summary |
| POST | `/api/admin/supplier-matching/dinamik-parcatedarik` | Run candidate generation (dry-run or apply) |
| POST | `/api/admin/supplier-matching/dinamik-parcatedarik/:id/approve` | Approve a match |
| POST | `/api/admin/supplier-matching/dinamik-parcatedarik/:id/reject` | Reject a match |
| POST | `/api/admin/supplier-matching/dinamik-parcatedarik/:id/ignore` | Ignore a match |
| POST | `/api/admin/supplier-matching/dinamik-parcatedarik/:id/needs-review` | Mark for review |
| POST | `/api/admin/supplier-matching/dinamik-parcatedarik/bulk-approve` | Bulk approve |

## Approval Process

When a match is APPROVED:
1. Resolve ParçaTedarik `ref_no` tokens to `public.parts`
2. If exactly one confident part candidate:
   - Look up the Dinamik `supplier_products` row by `stock_code`
   - If `supplier_products` row exists:
     - Create/update `supplier_part_mappings` with `match_reason = DINAMIK_BARCODE_PARCA_MODEL_TO_PART`
     - Create/update `part_supplier_offers` with:
       - `supplier_price` from `supplier_products.supplier_price` (fallback to `dinamik.products.price`)
       - `supplier_stock_qty` from `supplier_products.supplier_stock_qty`
       - `currency` from `supplier_products.currency` (fallback to `TRY`)
     - Call `applyPolicyForPart()` to update `part_pricing_inventory`
   - If no `supplier_products` row exists: return warning, skip mapping/offer creation
3. If ambiguous → set status to `NEEDS_REVIEW`

**Important**: The approve action propagates stock and price from `supplier_products` (which is synced by the Dinamik sync job). If the Dinamik sync has not run, `supplier_products.supplier_stock_qty` may be 0 or stale.

## Match Status Values

| Status | Description |
|---|---|
| `CANDIDATE` | New match, awaiting review |
| `APPROVED` | Approved by admin |
| `REJECTED` | Rejected by admin |
| `NEEDS_REVIEW` | Multiple candidates, needs manual review |
| `IGNORED` | Admin chose to ignore |

## Vehicle Fitment Strategy

**Do not** copy vehicle fitment rows into `dinamik.products`.

Vehicle fitment is displayed through resolved `public.parts` relations:
- Show vehicle fitment count from `part_vehicle_types`
- Show sample vehicle brands/models
- A materialized view may be created later if performance requires it

Future view (not implemented yet):
```sql
CREATE MATERIALIZED VIEW public.dinamik_product_vehicle_fitment_view AS
  SELECT ...
  FROM dinamik_parcatedarik_model_matches m
  JOIN v0.ptproducts pt ON ...
  JOIN part_oens oen ON ...
  JOIN part_vehicle_types pvt ON ...
```

## Schema

Table: `public.dinamik_parcatedarik_model_matches`

| Column | Type | Description |
|---|---|---|
| id | bigserial PK | Auto-incrementing ID |
| dinamik_product_id | bigint NOT NULL | References dinamik.products.id |
| parcatedarik_product_id | bigint NOT NULL | References v0.ptproducts.id |
| dinamik_barcode_field | text NOT NULL | barcode_1, barcode_2, or barcode_3 |
| dinamik_barcode_value | text NOT NULL | Original barcode value |
| normalized_barcode_value | text NOT NULL | Normalized barcode |
| parcatedarik_model | text NOT NULL | Original model value |
| normalized_model | text NOT NULL | Normalized model value |
| match_reason | text NOT NULL | Match reason code |
| confidence | numeric(5,4) NOT NULL DEFAULT 0.9500 | Confidence score |
| status | text NOT NULL DEFAULT 'CANDIDATE' | Match status |
| review_note | text NULL | Admin review note |
| approved_by | text NULL | User who approved |
| approved_at | timestamp NULL | When approved |
| rejected_by | text NULL | User who rejected |
| rejected_at | timestamp NULL | When rejected |
| created_at | timestamp NOT NULL DEFAULT now() | Created timestamp |
| updated_at | timestamp NOT NULL DEFAULT now() | Updated timestamp |

## Raw JSON Policy

- `dinamik.products.raw_json` must **never** be exposed to the browser
- Admin UI only shows `stock_code`, `stock_name`, `brand`, `price`, `barcode_1/2/3`

## Rollback Notes

To rollback:
```sql
DELETE FROM public.dinamik_parcatedarik_model_matches WHERE status = 'CANDIDATE';
-- or full rollback:
DROP TABLE IF EXISTS public.dinamik_parcatedarik_model_matches;
```

## Reindex Notes

After approved mappings:
```bash
bun run search:setup
MEILI_REINDEX_INCLUDE_FITMENT=false bun run search:reindex
```

Canonical `public.parts` should gain Dinamik supplier offers when mapped. Search results remain canonical parts, not duplicated Dinamik rows.

## Backfill Approved Match Offer Stock

Existing APPROVED matches created before the stock propagation fix may have `part_supplier_offers.supplier_stock_qty = 0`. To fix:

```bash
# Dry run (default, no writes):
DRY_RUN=true bun scripts/backfill-approved-dinamik-parcatedarik-offer-stock.ts

# Apply with limit:
APPLY=true LIMIT=5 bun scripts/backfill-approved-dinamik-parcatedarik-offer-stock.ts

# Apply to specific match:
APPLY=true MATCH_ID=123 bun scripts/backfill-approved-dinamik-parcatedarik-offer-stock.ts

# Full apply (use with caution):
APPLY=true bun scripts/backfill-approved-dinamik-parcatedarik-offer-stock.ts
```

The backfill script:
1. Finds APPROVED matches with `part_supplier_offers.supplier_stock_qty = 0`
2. Reads `supplier_products.supplier_stock_qty` and `supplier_price` for the matching Dinamik product
3. Updates `part_supplier_offers` with correct stock/price/currency
4. Calls `applyPolicyForPart()` to refresh `part_pricing_inventory`
5. Reports statistics on scanned/found/updated/missing records

After backfill, run Meilisearch reindex if needed.