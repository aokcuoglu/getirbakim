# Meilisearch Switch-Back Notes

Meilisearch is currently treated as disabled in runtime behavior because the hosted plan is not active.

## Current fallback mode

- `app/api/catalog/articles/route.ts` serves data via Prisma (`source: prisma-fallback`).
- `app/api/search/route.ts` returns a degraded empty payload when Meili multi-search is unavailable (`degraded: true`).

This keeps category pages and async price hydration functional without Meili.

## When Meilisearch is active again

1. Restore Meilisearch-backed implementation in `app/api/catalog/articles/route.ts`.
2. Remove the degraded fallback branch in `app/api/search/route.ts` catch block.
3. Verify Meili credentials and host in environment.
4. Re-run index sync/settings commands as needed.
5. Smoke test:
   - `POST /api/catalog/articles` returns `source` without `prisma-fallback`.
   - `POST /api/search` returns real hits/facets, not `degraded: true`.

## Optional guardrail

To make future toggling easier, consider introducing an explicit feature flag:

- `SEARCH_PROVIDER=prisma|meili`

Then branch provider selection via config instead of editing route handlers.
