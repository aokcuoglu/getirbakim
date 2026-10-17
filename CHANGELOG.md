# Changelog

All notable changes to this project are documented here. Versions follow [SemVer](https://semver.org/); see `docs/development-workflow.md`.

## v0.22.5 — 2026-10-17

Hotfix from `main`; the rest of `dev` is not included.

### Performance
- Listing pages: quantity selects render 10 options until hovered or focused; a 60-card category page carried ~6,000 `<option>`s (~190 kB of HTML) ([#244](https://github.com/aokcuoglu/getirbakim/issues/244), [#261](https://github.com/aokcuoglu/getirbakim/pull/261)).
- The app no longer gzips responses (`compress: false`); edge nginx and Cloudflare compress. Production app container: 2 CPUs.

## v0.22.4 — 2026-10-16

Hotfix from `main`; the rest of `dev` is not included.

### Fixed
- No product showed a price or stock since 2026-10-15: the production supplier sync crashed every run with a JavaScript heap out-of-memory (~256 MB heap in a 512 MB container), so supplier data aged past the 36 h freshness limit and the storefront hid all prices ([#253](https://github.com/aokcuoglu/getirbakim/issues/253), [#254](https://github.com/aokcuoglu/getirbakim/pull/254)). The `operations` container now has 2 GB and `NODE_OPTIONS=--max-old-space-size=1536`.

## v0.22.3 — 2026-10-16

Hotfix from `main`; the rest of `dev` is not included.

### Performance
- Category pages: the category filter is resolved to product ids before listing instead of an `OR` that forced a full scan of supplier items in each of the four listing queries (6–8 s each in production) ([#244](https://github.com/aokcuoglu/getirbakim/issues/244), [#247](https://github.com/aokcuoglu/getirbakim/pull/247)). New partial index `supplier_items_legacy_category_idx`.
- Production Postgres: 2 GB memory, `shared_buffers=512MB`, `effective_cache_size=1536MB`, `work_mem=16MB`, `random_page_cost=1.1`, `pg_stat_statements` preloaded ([#248](https://github.com/aokcuoglu/getirbakim/pull/248)).

### Operations
- Deploy recreates the production Postgres container once (a few seconds) to apply the new settings.
- Cloudflare Cache Rule "Cache storefront media API" caches `/api/product-media/`, `/api/category-media/`, `/api/manufacturer-logos/` (configured in the dashboard).

## v0.22.2 — 2026-10-16

Hotfix from `main`; the rest of `dev` is not included.

### Fixed
- Catalog and product pages intermittently returned HTTP 500 (`timeout exceeded when trying to connect`) when a few visitors loaded pages at once ([#234](https://github.com/aokcuoglu/getirbakim/issues/234), [#235](https://github.com/aokcuoglu/getirbakim/pull/235)):
  - DB pool raised from 5 clients / 3 s acquire timeout to 15 / 10 s, overridable with `DATABASE_POOL_MAX` and `DATABASE_POOL_ACQUIRE_TIMEOUT_MS`.
  - Idle database client errors are logged instead of crashing the app process.

## v0.22.1 — 2026-10-15

Hotfix from `main`; the rest of `dev` is not included.

### Fixed
- Storefront logos and brand prefetches returned HTTP 429 under the edge rate limit on large brand grids ([#226](https://github.com/aokcuoglu/getirbakim/issues/226), [#229](https://github.com/aokcuoglu/getirbakim/pull/229)):
  - CDN cache headers for `/media/*` and `/brand/*` (public files defaulted to `max-age=0`).
  - No viewport prefetch on brand grids (home, `/automakers`, catalog popular makes).
- Site images and fonts are served from `/media/site/` instead of a third-party-named path.

### Operations
- Edge nginx: `/media/`, `/brand/` and the image API routes are exempt from the general rate/connection limits (`/opt/edge`, applied manually).
