# Changelog

All notable changes to this project are documented here. Versions follow [SemVer](https://semver.org/); see `docs/development-workflow.md`.

## v0.24.0 — 2026-11-09

Full release of `dev` (130 pull requests since the v0.22 line forked). It contains the hotfixes of v0.22.1–v0.23.0 in their `dev` form. This is the release for the AWS migration; it was not deployed to Contabo.

### Added
- **Dinamik** as a supplier: brand-scoped stock and price lists, daily brand discovery, nightly full run (Dinamik last in each tick, 10-minute budget), sale at cost × (1 + margin) × (1 + VAT), and a live `getStock` refresh of the cart's Dinamik lines at checkout ([#141](https://github.com/aokcuoglu/getirbakim/pull/141), [#149](https://github.com/aokcuoglu/getirbakim/pull/149), [#157](https://github.com/aokcuoglu/getirbakim/pull/157), [#162](https://github.com/aokcuoglu/getirbakim/pull/162), [#163](https://github.com/aokcuoglu/getirbakim/pull/163)).
- **SETA** as a supplier: scheduled sync, admin page and storefront sale; inactive without `SETA_API_KEY` ([#140](https://github.com/aokcuoglu/getirbakim/pull/140), [#154](https://github.com/aokcuoglu/getirbakim/pull/154), [#171](https://github.com/aokcuoglu/getirbakim/pull/171), [#272](https://github.com/aokcuoglu/getirbakim/pull/272)).
- **Supplier egress proxy**: `SUPPLIER_EGRESS_PROXY` / `SUPPLIER_EGRESS_PROXY_FOR` tunnel the Dinamik API (or other listed suppliers) through the allow-listed VPS proxy over HTTP CONNECT; TLS verification stays end to end, payments never use it. Squid configuration in `infra/squid/` ([#412](https://github.com/aokcuoglu/getirbakim/pull/412), [#414](https://github.com/aokcuoglu/getirbakim/pull/414)).
- **Manual supplier lists**: xlsx template upload for non-API suppliers (lubricants) ([#347](https://github.com/aokcuoglu/getirbakim/pull/347)).
- **Master catalog**: master products with their supplier sources, canonical brands (`brands` + `supplier_brands`), OEM/barcode equivalents, cheapest offer per product, candidate review with manual merge and manual equivalents, name-conflict guard ([#148](https://github.com/aokcuoglu/getirbakim/pull/148), [#161](https://github.com/aokcuoglu/getirbakim/pull/161), [#167](https://github.com/aokcuoglu/getirbakim/pull/167), [#183](https://github.com/aokcuoglu/getirbakim/pull/183), [#191](https://github.com/aokcuoglu/getirbakim/pull/191), [#196](https://github.com/aokcuoglu/getirbakim/pull/196), [#202](https://github.com/aokcuoglu/getirbakim/pull/202), [#203](https://github.com/aokcuoglu/getirbakim/pull/203), [#205](https://github.com/aokcuoglu/getirbakim/pull/205), [#209](https://github.com/aokcuoglu/getirbakim/pull/209), [#219](https://github.com/aokcuoglu/getirbakim/pull/219), [#221](https://github.com/aokcuoglu/getirbakim/pull/221)).
- **Product enrichment** sources and tooling: otoparcasan, spareto and parts2world (TecDoc) next to Trodo, OE-number reach for OE-coded and private-label brands, partial-data recovery and image fill, model-level fitment from supplier descriptions, admin dashboard with per-source progress ([#138](https://github.com/aokcuoglu/getirbakim/pull/138), [#139](https://github.com/aokcuoglu/getirbakim/pull/139), [#197](https://github.com/aokcuoglu/getirbakim/pull/197), [#199](https://github.com/aokcuoglu/getirbakim/pull/199), [#208](https://github.com/aokcuoglu/getirbakim/pull/208), [#213](https://github.com/aokcuoglu/getirbakim/pull/213), [#216](https://github.com/aokcuoglu/getirbakim/pull/216), [#223](https://github.com/aokcuoglu/getirbakim/pull/223), [#225](https://github.com/aokcuoglu/getirbakim/pull/225), [#228](https://github.com/aokcuoglu/getirbakim/pull/228), [#233](https://github.com/aokcuoglu/getirbakim/pull/233), [#237](https://github.com/aokcuoglu/getirbakim/pull/237), [#239](https://github.com/aokcuoglu/getirbakim/pull/239), [#243](https://github.com/aokcuoglu/getirbakim/pull/243), [#246](https://github.com/aokcuoglu/getirbakim/pull/246), [#265](https://github.com/aokcuoglu/getirbakim/pull/265), [#266](https://github.com/aokcuoglu/getirbakim/pull/266), [#273](https://github.com/aokcuoglu/getirbakim/pull/273), [#285](https://github.com/aokcuoglu/getirbakim/pull/285), [#287](https://github.com/aokcuoglu/getirbakim/pull/287), [#297](https://github.com/aokcuoglu/getirbakim/pull/297), [#305](https://github.com/aokcuoglu/getirbakim/pull/305), [#309](https://github.com/aokcuoglu/getirbakim/pull/309), [#312](https://github.com/aokcuoglu/getirbakim/pull/312), [#342](https://github.com/aokcuoglu/getirbakim/pull/342), [#358](https://github.com/aokcuoglu/getirbakim/pull/358), [#360](https://github.com/aokcuoglu/getirbakim/pull/360), [#362](https://github.com/aokcuoglu/getirbakim/pull/362), [#364](https://github.com/aokcuoglu/getirbakim/pull/364), [#366](https://github.com/aokcuoglu/getirbakim/pull/366), [#368](https://github.com/aokcuoglu/getirbakim/pull/368), [#370](https://github.com/aokcuoglu/getirbakim/pull/370), [#372](https://github.com/aokcuoglu/getirbakim/pull/372), [#374](https://github.com/aokcuoglu/getirbakim/pull/374), [#375](https://github.com/aokcuoglu/getirbakim/pull/375), [#377](https://github.com/aokcuoglu/getirbakim/pull/377), [#381](https://github.com/aokcuoglu/getirbakim/pull/381), [#383](https://github.com/aokcuoglu/getirbakim/pull/383), [#385](https://github.com/aokcuoglu/getirbakim/pull/385), [#387](https://github.com/aokcuoglu/getirbakim/pull/387), [#389](https://github.com/aokcuoglu/getirbakim/pull/389), [#391](https://github.com/aokcuoglu/getirbakim/pull/391), [#393](https://github.com/aokcuoglu/getirbakim/pull/393), [#395](https://github.com/aokcuoglu/getirbakim/pull/395), [#397](https://github.com/aokcuoglu/getirbakim/pull/397), [#400](https://github.com/aokcuoglu/getirbakim/pull/400), [#402](https://github.com/aokcuoglu/getirbakim/pull/402), [#404](https://github.com/aokcuoglu/getirbakim/pull/404), [#406](https://github.com/aokcuoglu/getirbakim/pull/406), [#408](https://github.com/aokcuoglu/getirbakim/pull/408), [#410](https://github.com/aokcuoglu/getirbakim/pull/410)).
- **Vehicles**: REPXPERT type specs and transparent type images in the garage sheet, model families in the vehicle picker, engine-oil specs from Trodo/TecRMI with oil filters on oil listings ([#252](https://github.com/aokcuoglu/getirbakim/pull/252), [#260](https://github.com/aokcuoglu/getirbakim/pull/260), [#293](https://github.com/aokcuoglu/getirbakim/pull/293), [#301](https://github.com/aokcuoglu/getirbakim/pull/301), [#310](https://github.com/aokcuoglu/getirbakim/pull/310), [#314](https://github.com/aokcuoglu/getirbakim/pull/314), [#317](https://github.com/aokcuoglu/getirbakim/pull/317), [#318](https://github.com/aokcuoglu/getirbakim/pull/318), [#320](https://github.com/aokcuoglu/getirbakim/pull/320), [#323](https://github.com/aokcuoglu/getirbakim/pull/323), [#324](https://github.com/aokcuoglu/getirbakim/pull/324), [#328](https://github.com/aokcuoglu/getirbakim/pull/328), [#332](https://github.com/aokcuoglu/getirbakim/pull/332), [#334](https://github.com/aokcuoglu/getirbakim/pull/334), [#336](https://github.com/aokcuoglu/getirbakim/pull/336), [#338](https://github.com/aokcuoglu/getirbakim/pull/338), [#340](https://github.com/aokcuoglu/getirbakim/pull/340), [#354](https://github.com/aokcuoglu/getirbakim/pull/354)).
- **Bakım Robotu** maintenance-kit builder with a composed set image and a home carousel banner ([#298](https://github.com/aokcuoglu/getirbakim/pull/298), [#304](https://github.com/aokcuoglu/getirbakim/pull/304), [#306](https://github.com/aokcuoglu/getirbakim/pull/306)).
- **Admin**: `/yonetim` rebuilt on stock shadcn/ui with the IBM Carbon palette; sortable, header-filterable, searchable tables; per-product margin/VAT; brand and category filters on products; supplier detail and pricing modals ([#143](https://github.com/aokcuoglu/getirbakim/pull/143), [#150](https://github.com/aokcuoglu/getirbakim/pull/150), [#153](https://github.com/aokcuoglu/getirbakim/pull/153), [#158](https://github.com/aokcuoglu/getirbakim/pull/158), [#168](https://github.com/aokcuoglu/getirbakim/pull/168), [#169](https://github.com/aokcuoglu/getirbakim/pull/169), [#175](https://github.com/aokcuoglu/getirbakim/pull/175), [#177](https://github.com/aokcuoglu/getirbakim/pull/177), [#181](https://github.com/aokcuoglu/getirbakim/pull/181), [#186](https://github.com/aokcuoglu/getirbakim/pull/186), [#187](https://github.com/aokcuoglu/getirbakim/pull/187), [#189](https://github.com/aokcuoglu/getirbakim/pull/189), [#211](https://github.com/aokcuoglu/getirbakim/pull/211), [#217](https://github.com/aokcuoglu/getirbakim/pull/217), [#292](https://github.com/aokcuoglu/getirbakim/pull/292), [#295](https://github.com/aokcuoglu/getirbakim/pull/295), [#327](https://github.com/aokcuoglu/getirbakim/pull/327), [#330](https://github.com/aokcuoglu/getirbakim/pull/330)).

### Changed
- Engine-oil listings show the viscosity/approval filter buttons (v0.23.0 showed the banner for information only) ([#293](https://github.com/aokcuoglu/getirbakim/pull/293)).
- Listing, category and search pages show 30 products; lighter listing HTML; category filter resolved to ids; part-number indexes for product reference links; cached home picks ([#247](https://github.com/aokcuoglu/getirbakim/pull/247), [#261](https://github.com/aokcuoglu/getirbakim/pull/261), [#267](https://github.com/aokcuoglu/getirbakim/pull/267), [#274](https://github.com/aokcuoglu/getirbakim/pull/274), [#281](https://github.com/aokcuoglu/getirbakim/pull/281)).
- Supplier sync loads snapshots in 2,000-item chunks; operations container 2 GB with a 1.5 GB heap; production Postgres 2 GB / `shared_buffers` 512 MB ([#248](https://github.com/aokcuoglu/getirbakim/pull/248), [#254](https://github.com/aokcuoglu/getirbakim/pull/254), [#278](https://github.com/aokcuoglu/getirbakim/pull/278)).
- Storefront bundles are split into parts that fit production memory ([#379](https://github.com/aokcuoglu/getirbakim/pull/379)).

### Fixed
- Catalog 500s from database pool exhaustion (pool 15 / 10 s, idle-client error listener) ([#235](https://github.com/aokcuoglu/getirbakim/pull/235)).
- Site assets served under `/media/site`; storefront copy presents the site as live with hey@getirbakim.com; unconnected plate lookup removed; return to the original page after re-login ([#229](https://github.com/aokcuoglu/getirbakim/pull/229), [#289](https://github.com/aokcuoglu/getirbakim/pull/289), [#345](https://github.com/aokcuoglu/getirbakim/pull/345), [#351](https://github.com/aokcuoglu/getirbakim/pull/351)).

### Maintenance
- Development, versioning and release policy; deploy workflows run only on explicit request ([#146](https://github.com/aokcuoglu/getirbakim/pull/146)). Lockfile root spec synced for the pinned exceljs ([#349](https://github.com/aokcuoglu/getirbakim/pull/349)).

### Deploy and migration
- `scripts/setup.ts` (run by `deploy-production.sh` before the app starts) applies every `db/*.sql` idempotently, including the rename of the legacy `products` table to `store_products` and the master-catalog, matching, enrichment, vehicle and supplier tables. Run it against the restored v0.23.0 database, then `ANALYZE`.
- After the first supplier runs, build the master catalog once: `node --import tsx scripts/match-products.ts` in the operations container (`refresh_product_matches()`, ~1–2 min). It is not scheduled; re-run it after large supplier changes.
- Dinamik starts with the first scheduler tick (brand list, then brands in 10-minute slices; a full pass takes about two hours of ticks). Outside the VPS set `SUPPLIER_EGRESS_PROXY` (see `infra/squid/README.md`); Başbuğ and TAMI have no IP restriction.
- New optional settings: `SUPPLIER_EGRESS_PROXY`, `SUPPLIER_EGRESS_PROXY_FOR`, `SETA_API_KEY`, `SETA_BASE_URL`, `DINAMIK_TICK_MINUTES`.
- Enrichment data reaches production through `npm run storefront:sync`, which currently ships bundles to the VPS over SSH; it needs a new target after the migration.

## v0.23.0 — 2026-10-21

Scoped port from `dev`; the rest of `dev` is not included.

### Added
- Engine-oil listings (the oil categories, a search for engine oil or an SAE grade) show the garage vehicle's recommended oil: capacity, SAE grades, ACEA/API classes and manufacturer approvals, for 23,251 vehicle types from TecRMI (via Trodo) and the earlier oil-capacity sheet ([#290](https://github.com/aokcuoglu/getirbakim/issues/290), [#315](https://github.com/aokcuoglu/getirbakim/issues/315), [#353](https://github.com/aokcuoglu/getirbakim/issues/353), [#355](https://github.com/aokcuoglu/getirbakim/issues/355)).
- The engine-oil category also lists oils recognised by the grade in their name ([#290](https://github.com/aokcuoglu/getirbakim/issues/290)).
- `db/vehicle-oil-specs.sql` (applied by `db:setup`) and `npm run db:vehicle-oils` load `data/vehicle_type_oil_specs.csv`.

### Notes
- The banner only informs in this release: the viscosity/approval filter buttons are hidden because the storefront lists 12 graded Başbuğ oils and none meets a vehicle's grade and approval together. The `?oil=` filter itself is in place.
- Production's `vehicle_type_oil_specs` was loaded on 2026-10-21 (23,251 rows); no migration step is needed at deploy.

## v0.22.11 — 2026-10-19

Hotfix from `main`; the rest of `dev` is not included.

### Fixed
- The garage sheet no longer shows a licence-plate search that was not connected to any service ([#350](https://github.com/aokcuoglu/getirbakim/issues/350)).

## v0.22.10 — 2026-10-19

Hotfix from `main`; the rest of `dev` is not included.

### Fixed
- Storefront copy no longer describes the site as in development, unpublished or running locally (about, help, compatibility, services, legal pages, auth and empty states); the "Satış Hizmetinin Durumu" alert is removed ([#344](https://github.com/aokcuoglu/getirbakim/issues/344)).
- `hey@getirbakim.com` is published on /iletisim, every legal page's company card, the footer, help, services and the Organization JSON-LD; the seller company details are unchanged ([#344](https://github.com/aokcuoglu/getirbakim/issues/344)).
- Hashed CSS/JS of earlier releases stay served for 14 days from a `next-static` volume, so a page opened just before a deploy no longer renders unstyled ([#344](https://github.com/aokcuoglu/getirbakim/issues/344)).

## v0.22.9 — 2026-10-17

Hotfix from `main`; the rest of `dev` is not included. Deployed together with v0.22.8.

### Changed
- Category, make and search pages show 30 products per page instead of 60; a category page drops from ~1.15 MB to ~0.6–0.8 MB of HTML ([#244](https://github.com/aokcuoglu/getirbakim/issues/244), [#281](https://github.com/aokcuoglu/getirbakim/pull/281)).

## v0.22.8 — 2026-10-17

Hotfix from `main`; the rest of `dev` is not included.

### Performance
- Supplier sync loads each snapshot into the database in 2,000-item chunks instead of one JSON parameter. On a 150,000-item test the old path needed +786 MB RSS and failed under a 256 MB heap (the production crash of #253); the chunked path completes with about +120 MB ([#277](https://github.com/aokcuoglu/getirbakim/issues/277), [#278](https://github.com/aokcuoglu/getirbakim/pull/278)).
- Sync log lines include the run's peak memory (`peakRssMB`).

## v0.22.7 — 2026-10-17

Hotfix from `main`; the rest of `dev` is not included.

### Performance
- Home page: the four "newest products" picks (latest + three collections) cache their product ids for 10 minutes; price and stock are still read on every request. Each pick read every enrichment (~0.4 s) ([#244](https://github.com/aokcuoglu/getirbakim/issues/244), [#274](https://github.com/aokcuoglu/getirbakim/pull/274)).

## v0.22.6 — 2026-10-17

Hotfix from `main`; the rest of `dev` is not included.

### Performance
- Product pages: cross-reference and OEM link lookups read new expression indexes (`part_number_key()`, `supplier_items_part_key_idx`, `supplier_items_oem_key_idx`) instead of normalising every catalog item; ~2 s each in production, ~5 ms locally with the same results ([#244](https://github.com/aokcuoglu/getirbakim/issues/244), [#267](https://github.com/aokcuoglu/getirbakim/pull/267)).

### Operations
- Deploy builds two indexes on `supplier_items` (a few seconds; writes to the table wait meanwhile).

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
