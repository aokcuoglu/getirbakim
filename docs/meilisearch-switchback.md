# Meilisearch Switch-Back Notes

## Current status (v0.2.3+)

Meilisearch is now **self-hosted** via Docker on the same VPS. When `MEILI_ENABLED=true`, search queries go to Meilisearch first, with PostgreSQL catalog+offer search as fallback.

## Search flow

When `MEILI_ENABLED=true`:
1. `/api/search` queries Meilisearch `products` index first
2. Response includes `source: "meilisearch"` and `liveFallbackUsed: false`
3. On Meili error: falls back to PostgreSQL with `liveFallbackUsed: true`
4. Products with price/stock are prioritized (PURCHASABLE)
5. Products without price remain visible (REQUEST_PRICE)

When `MEILI_ENABLED=false` (or unset):
1. `/api/search` uses PostgreSQL catalog+offer search
2. Response includes `source: "postgres_catalog_offer_search"` and `degraded: true`
3. Broad queries like "Bosch" may take up to 2s (vs <1s with Meili)

## Switching between providers

Set `MEILI_ENABLED=true` or `MEILI_ENABLED=false` in `.env` / `.env.production` and restart.

After enabling:
```bash
docker compose exec app bun run search:setup
docker compose exec app bun run search:reindex
```

After disabling, the app seamlessly falls back to PostgreSQL search.

## Key files

- `lib/search/meilisearch-client.ts` — Meili client, health check, config
- `lib/search/search-document-builder.ts` — Document builder for indexing
- `lib/search/setup-index.ts` — Index configuration
- `scripts/meili-setup.ts` — Setup script
- `scripts/meili-reindex.ts` — Reindex script
- `app/api/search/route.ts` — Search endpoint with Meili-first + PostgreSQL fallback
- `docker-compose.yml` / `docker-compose.local.yml` — Meili service definition

## Setup guide

See `docs/SEARCH_MEILISEARCH_SELF_HOSTED.md` for full setup, troubleshooting, and security notes.