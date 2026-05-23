# Review Agent Log

## Review Charter

Review V1 work for correctness, regression safety, and accidental wrong-product sales. Findings should prioritize customer harm, stock/price accuracy, and admin approval safety.

## Required Checks

- Public APIs must not expose `dinamik.products.raw_json`.
- Products without approved/manual Dinamik matches must not be purchasable.
- Products without positive price or positive stock must not be purchasable.
- Admin-only matching endpoints must keep auth and role checks.
- Manual matching must leave an audit trail through match status, note, and timestamps where available.
- Vehicle compatibility must not be implied by ParcaTedarik/Dinamik matching alone.

## Known Risk Areas

- `APPROVED` and `MANUAL_MATCH` status semantics must stay explicit.
- Dinamik `supplier_products` data may be stale if sync has not run.
- Fallback to `dinamik.products.price` must not be treated as live stock confirmation.
- Existing canonical search/card components use `REQUEST_PRICE` semantics that differ slightly from the V1 DTO names.

## Approval Recommendation Format

- Approve only after targeted tests pass.
- If tests cannot run, record the exact blocker.
- For every change touching matching, record whether wrong-product sale risk increased, decreased, or stayed the same.
