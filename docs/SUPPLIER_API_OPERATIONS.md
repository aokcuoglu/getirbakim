# Supplier API Operations

## Overview

GetirBakim V2 integrates with multiple supplier APIs to provide real-time pricing, stock availability, and product data.

## Active Suppliers

| Supplier | Code | Priority | Status | Sync Mode |
|----------|------|----------|--------|-----------|
| Dinamik  | `dinamik` | 10 | Active | Periodic + Live |
| SETA     | `seta` | 20 | Active | Periodic + Live |
| Başbuğ   | `basbug` | — | Planned | — |

## Operational Strategy

### Periodic Sync (Background Jobs)

- **Full catalog sync**: Nightly (03:00-05:00 TRT) — all brands, upsert products, OEMs, mappings, offers
- **Price/stock delta sync**: Every 2-4 hours during business hours — changed items only
- **Live check**: Before add-to-cart and before payment — real-time SKU check

### Sync Flow

1. Fetch brand/product data from supplier API
2. Upsert `supplier_products`, `supplier_product_oems`, `supplier_brand_aliases`
3. Run `findBestCandidate()` to match supplier SKUs to catalog parts
4. Auto-approve mappings above confidence threshold
5. Create `part_supplier_offers` for approved mappings
6. Run `applyPolicyForPart()` → upsert `part_pricing_inventory`
7. Invalidate caches and search index

### Failure and Retry

- Transient failures: retry 3x with exponential backoff
- Auth failures: do not retry, alert admin
- Rate limiting: respect Retry-After, queue for next cycle
- Partial failures: continue, log summary
- Job failures: mark `supplier_sync_runs` as FAILED, admin intervention required

### Stale Data Handling

- `supplier_products.last_seen_at` tracks freshness
- Older than 24h: consider stock potentially stale, show "Uygunluk Sor" CTA
- Older than 7 days: mark `part_pricing_inventory.sync_status = 'STALE'`

## Matching Strategy

See `docs/SUPPLIER_PART_MATCHING.md` for full matching strategy, confidence scores, auto-approve rules, and orphan product handling.

Key principles:
- `parts` is the canonical catalog
- Supplier products enrich and sell canonical parts when matched
- OEM exact matches auto-approve (≥0.95 confidence)
- EAN exact matches auto-approve (≥0.95 confidence)
- Cross-reference matches are always `CANDIDATE` (never auto-approved)
- Brand alias matches are `CANDIDATE`
- Name similarity matches are `NEEDS_REVIEW` (never auto-approved)
- Orphan supplier products remain indexed and searchable until matched

## Files

- `lib/suppliers/dinamik-client.ts` — Dinamik API client
- `lib/suppliers/sync-dinamik.ts` — Dinamik sync pipeline
- `lib/suppliers/seta-client.ts` — SETA API client
- `lib/suppliers/sync-seta.ts` — SETA sync pipeline
- `lib/suppliers/parts2world/` — Parts2World sync
- `lib/search/supplier-part-matching.ts` — Reindex-time matching candidates
- `lib/search/search-document-builder.ts` — Meilisearch document builder
- `lib/search/search-document-types.ts` — Document type definitions
- `lib/search/search-synonyms.ts` — Turkish/English synonym mappings

## Future: Admin Sync Dashboard

- Last sync time per supplier
- Sync status (running/completed/failed)
- Manual trigger for full or delta sync
- Stale product counts