# Main Agent Log

## Mission

Drive the V1 fast-sales strategy: ParcaTedarik is the public catalog source, Dinamik supplies price and stock, and uncertain products remain visible with request CTAs.

## Current Decisions

- Do not move code into a physical `v0/` folder.
- Use `v0-current-platform` as the archive tag.
- Keep canonical `public.parts` behavior available for rollback and future fitment work.
- For V1 public product display, never claim vehicle compatibility unless it is verified elsewhere.
- A product is purchasable only when it has an approved/manual Dinamik match, positive price, and positive stock.

## Implementation Backlog

- Add V1 ParcaTedarik catalog read model and API.
- Add storefront page/components for the new read model.
- Connect request CTA to the existing customer request flow.
- Add checkout guard so only V1 purchasable items can be submitted.
- Keep admin matching ParcaTedarik-centered and make manual matching first-class for `PT_UNMATCHED`.

## Handoff Notes

- Existing Dinamik-ParcaTedarik admin code is already in progress and should be preserved.
- Treat matching changes as high-risk; prefer explicit status checks over implicit matching.
- Avoid broad refactors until the V1 sale path is working end to end.
