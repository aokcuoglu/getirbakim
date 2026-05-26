# v0 catalog search

When `NEXT_PUBLIC_V0_ONLY_SITE` is enabled (default), search queries approved rows in:

- `v0.dpmatch` — products (linked to `/part/[matchId]`)
- `v0.dbrands_match` — brands (grouped, linked to `/marka/[matchId]`)

## Data path

1. **Global search (⌘K)** — `searchGlobal` server action → v0 search module
2. **Search page** — `POST /api/search` → `buildV0SearchApiResponse` when v0-only mode is on

## Meilisearch (recommended)

Set:

```env
MEILI_ENABLED=true
MEILI_HOST=http://127.0.0.1:7700   # local; use http://meilisearch:7700 inside Docker
MEILI_MASTER_KEY=...
MEILI_INDEX_V0=v0-catalog
```

If `MEILI_ENABLED=true` but the `v0-catalog` index is missing or empty, search automatically falls back to PostgreSQL. For production performance, always run setup + reindex after approvals.

Indexed product fields (priority order in Meilisearch): `brandName` (from `v0.dbrands_match`), `name`, `ptproducts.title`, `ptproducts.model`, Dinamik `stock_code`, `ptproducts.ref_no` (cross-refs, lower priority), `dproduct_details.raw`, part numbers/barcodes in `oemCodes`.

Setup and reindex (from host — use port 7700, not the Docker service name):

```bash
MEILI_HOST=http://127.0.0.1:7700 bun run search:v0:setup
MEILI_HOST=http://127.0.0.1:7700 bun run search:v0:reindex
# Full rebuild:
MEILI_REINDEX_CLEAR=true MEILI_HOST=http://127.0.0.1:7700 bun run search:v0:reindex
```

Cron (optional):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/internal/search/v0-reindex
```

## PostgreSQL fallback

If Meilisearch is disabled or unreachable, search uses indexed SQL on `v0.dpmatch` / `v0.dbrands_match` (ILIKE on part numbers, titles, brands, barcodes).

## After approvals

Re-run `search:v0:reindex` (or the cron endpoint) so new approved `dpmatch` / `dbrands_match` rows appear in Meilisearch.
