# ADR-0001: V1 ParcaTedarik Catalog With Dinamik Sellability

## Status

Accepted

## Context

The existing platform has broad vehicle compatibility, canonical parts, supplier matching, and search behavior. That is valuable but too complex for a fast first sales release. Compatibility mistakes can cause wrong parts to be sold.

## Decision

For V1, the public catalog is centered on ParcaTedarik products. Dinamik is used to decide whether a ParcaTedarik product can be sold through approved/manual matches and synced price/stock.

## Consequences

- Faster path to a sellable storefront.
- Lower risk of making unverified vehicle compatibility claims.
- Existing canonical `public.parts` infrastructure remains available for future fitment and richer search.
- Admin matching quality becomes the main operational control point.

## Non-Goals

- Do not remove the canonical `public.parts` model.
- Do not copy vehicle fitment into Dinamik raw product tables.
- Do not expose Dinamik raw payloads to public clients.
