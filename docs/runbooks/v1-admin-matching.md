# V1 Admin Matching Runbook

## Goal

Create safe ParcaTedarik-to-Dinamik matches so ParcaTedarik catalog products can become sellable.

## Daily Workflow

1. Review brand aliases in `/admin/brand-aliases/dinamik-parca`.
2. Generate or refresh model matches with dry-run first.
3. Review `/admin/supplier-matching/dinamik-parcatedarik`.
4. Approve only clear matches.
5. Use manual matching for `PT_UNMATCHED` products when the correct Dinamik stock code is known.
6. Run targeted validation and reindex if public search/listing uses indexed data.

## Commands

```bash
DRY_RUN=true bun scripts/generate-dinamik-parcatedarik-model-matches.ts
APPLY=true LIMIT=500 bun scripts/generate-dinamik-parcatedarik-model-matches.ts
DRY_RUN=true bun scripts/generate-pt-unmatched.ts
APPLY=true LIMIT=500 bun scripts/generate-pt-unmatched.ts
```

## Approval Rules

- Approve `APPROVED` only when ParcaTedarik title/model/manufacturer and Dinamik stock code/name/brand clearly refer to the same product.
- Prefer manual review for multiple ParcaTedarik model matches.
- Reject or ignore noisy matches instead of forcing a sale.
- If Dinamik sync has not populated `supplier_products`, do not rely on a price-only fallback for stock.

## Failure Modes

- Missing Dinamik supplier product: run Dinamik sync first.
- Positive price with zero stock: product remains visible but not purchasable.
- Ambiguous ref_no resolution: leave as `NEEDS_REVIEW`.
- Wrong brand alias: revert alias approval and regenerate affected candidates.
