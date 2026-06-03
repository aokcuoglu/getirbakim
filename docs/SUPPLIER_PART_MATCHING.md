# Supplier Part Matching Strategy

## Overview

GetirBakim V2 uses a **canonical-parts-first** strategy for search and product display. The `parts` table is the canonical product catalog. Supplier products from Dinamik, SETA, Başbuğ and future suppliers provide stock, price, SKU, barcode and OEM data that enriches and sells canonical parts.

---

## Canonical Parts Strategy

- `parts` is the single source of truth for the product catalog
- Each canonical part has a `partId` and routes to `/part/<partId>`
- Canonical parts include brand, category, OEM codes, EAN codes, cross-references, pricing, stock, and fitment data
- Products with price+stock are `PURCHASABLE` (CTA: Add to Cart)
- Products without price remain visible as `REQUEST_PRICE` (CTA: Request Price)
- No canonical part should be hidden from search regardless of pricing status

## Supplier Product Matching Strategy

### Mapping Flow

```
Supplier Product → OEM/EAN/cross-reference matching → canonical part (parts table)
```

When a supplier product is matched to a canonical part:
1. The canonical part receives supplier pricing and stock data
2. `part_pricing_inventory` is updated with the best offer for the canonical part
3. `part_cross_references` may be created for the supplier SKU/brand pair

### Match Reasons and Confidence

| Match Reason | Confidence Range | Auto-Approve | Description |
|---|---|---|---|
| `OEM_EXACT` | 0.95–0.99 | Yes (≥0.95) | Supplier product OEM matches canonical part OEM exactly |
| `EAN_EXACT` | 0.95–0.99 | Yes (≥0.95) | Supplier barcode/EAN matches canonical part EAN exactly |
| `CROSS_REFERENCE_EXACT` | 0.85–0.95 | No (usually) | Supplier SKU/reference matches a cross-reference article number; brand match boosts confidence |
| `BRAND_ALIAS_REFERENCE` | 0.75–0.90 | No | Supplier brand maps to a canonical brand via brand alias lookup |
| `NAME_SIMILARITY` | 0.40–0.70 | Never | Name similarity match; candidate only, requires manual review |

### Match Statuses

| Status | Description |
|---|---|
| `APPROVED` | Mapping confirmed, product sells through canonical part |
| `CANDIDATE` | High-confidence match, pending review |
| `QUEUE` | Awaiting matching, no candidate yet |
| `NEEDS_REVIEW` | Low-confidence match, requires manual intervention |
| `MANUAL` | Manually created mapping |
| `UNMAPPED` | No mapping exists (orphan supplier product) |

### When to Auto-Approve

- **OEM exact match**: Auto-approve only if confidence ≥ 0.95 and brand verified
- **EAN exact match**: Auto-approve only if confidence ≥ 0.95
- **Cross-reference exact**: Never auto-approve (always `CANDIDATE` or `QUEUE`)
- **Brand alias reference**: Never auto-approve
- **Name similarity**: Never auto-approve (always `NEEDS_REVIEW`)

## Orphan Supplier Products

If a supplier product has:
- No approved mapping to a canonical part

...then it is an **orphan supplier product**.

Orphan products are:
- Indexed in Meilisearch with `documentType: orphan_supplier_product`
- Searchable by SKU, brand, name, OEM, and barcode
- Displayed with `availabilityStatus: PURCHASABLE` (if they have price) or `REQUEST_PRICE`
- Routable to `/supplier-product/<supplierProductId>` detail page
- Tagged with `matchStatus: UNMAPPED`

The matching module (`lib/search/supplier-part-matching.ts`) identifies candidate canonical parts for orphans but does not auto-approve low-confidence matches.

## Supplier Data Connections

### Dinamik
- Periodic catalog sync via `lib/suppliers/sync-dinamik.ts`
- OEM matching with `findBestCandidate()` (article_link_id → part lookup)
- Brand verification via brand alias mapping
- Auto-approve threshold: 0.98 confidence

### SETA
- Periodic catalog sync via `lib/suppliers/sync-seta.ts`
- EAN/barcode matching (score 0.65), article_link_id matching (score 0.9), OEM matching (score 0.75)
- Auto-approve threshold: 0.9 with strong signal
- OEM-only matches never auto-approved

### Başbuğ (Planned)
- Future supplier; matching framework supports adding new providers

## Future: Admin Mapping Workbench

A planned admin interface will:
- List orphan supplier products with candidate matches
- Allow manual approval/rejection of candidate mappings
- Show confidence scores and match reasons
- Support bulk approval for high-confidence OEM/EAN matches
- Track mapping history and audit trail
- Visual diff between supplier product and candidate canonical part data

## Code Normalization (v0.2.5+)

OEM/EAN/SKU/reference code matching uses centralized normalization from `lib/search/code-normalization.ts`:

- `normalizeCode(value)`: Uppercase, remove spaces/dashes/dots/slashes/backslashes, preserve leading zeros
- `compactCode(value)`: Lowercase, remove all non-alphanumeric, preserve leading zeros
- `isExactCodeQuery(query)`: Detects code-like queries (5+ chars, 70%+ alphanumeric, ≤3 separators)

These are used in:
- `exact-code-lookup.ts` — direct DB lookup for OEM/EAN/SKU/reference codes
- `search-document-builder.ts` — `exactCodes` array in each search document
- `catalog-offer-search.ts` — `toCompactCode()` and `normalizeForSearch()` (legacy)

## Reindex Priority (v0.2.6)

Code-bearing records are prioritized during reindex to ensure exact code searches work within index limits:

1. **Orphan supplier products**: sorted by (has OEM codes, has barcode, has price+stock, last_seen_at)
2. **Catalog-only parts**: sorted by (has OEM codes, has EAN codes, has cross-refs, has pricing)

See `docs/SEARCH_CODE_AND_FITMENT.md` for full details.

## Dinamik-ParcaTedarik Model Matching (v0.3.0-stage-2)

A new matching pathway connects Dinamik products to ParcaTedarik products via barcode-to-model matching, then resolves to canonical `public.parts` via ParcaTedarik `ref_no` tokens.

### Match Table

Matches are stored in `public.dinamik_parcatedarik_model_matches` with statuses `CANDIDATE`, `APPROVED`, `REJECTED`, `NEEDS_REVIEW`, `IGNORED`.

See `docs/DINAMIK_PARCA_MODEL_MATCHING_ADMIN.md` for full details.