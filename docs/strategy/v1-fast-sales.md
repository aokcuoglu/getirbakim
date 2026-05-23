# V1 Fast Sales Strategy

## Summary

V1 narrows the public sales path so the site can sell faster without depending on complete vehicle-to-part compatibility. ParcaTedarik provides the visible catalog. Dinamik provides sellability through approved/manual matches, price, and stock.

## Product Source Model

- Public title, manufacturer, image, model, and reference numbers come from `parcatedarik.product` and `parcatedarik.manufacturer`.
- Sellability comes from `public.dinamik_parcatedarik_model_matches`.
- A match is considered sellable only when status is `APPROVED` or `MANUAL_MATCH`.
- Dinamik price/stock should prefer synced `supplier_products` / `part_supplier_offers`; fallback to `dinamik.products.price` is price-only and does not prove stock.

## Public Behavior

- `PURCHASABLE`: approved/manual match, positive price, positive stock.
- `REQUEST_PRICE`: approved/manual match exists but price is missing.
- `OUT_OF_STOCK`: approved/manual match exists and price is present, but stock is not positive.
- `NEEDS_MATCH_REVIEW`: no approved/manual match yet.

Only `PURCHASABLE` products can be added to cart. All other statuses remain visible and use request/availability CTAs.

## MVP Acceptance Criteria

- Public API returns ParcaTedarik catalog items with V1 availability and CTA.
- Response never includes Dinamik raw JSON.
- Unmatched products remain visible but cannot be purchased.
- Approved/manual matched products are purchasable only with positive price and stock.
- Admin matching remains protected by admin auth.
