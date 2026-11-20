# Changelog

All notable changes to this project are documented here. Versions follow [SemVer](https://semver.org/); see `docs/development-workflow.md`.

## Unreleased

## v0.33.0 — 2026-11-20

Release of `dev` since v0.32.1 (6 pull requests): saved addresses at checkout, order email through Amazon SES, two supplier-sync fixes that kept the Dinamik alarm open and delayed the nightly import, and removal of the unused `vehicle_brands.popular` column. The privacy text update (#1014) is held back (reverted in #1074) until its legal placeholders are filled.

### Added
- **Saved addresses at checkout:** approved service and admin accounts pick a saved delivery or invoice address on `/siparis-olustur` and can save a new one to their address book after a successful order (duplicates and a full book of 10 are skipped; saving never blocks the order) ([#1015](https://github.com/aokcuoglu/getirbakim/pull/1015), [#999](https://github.com/aokcuoglu/getirbakim/issues/999)).
- **Dinamik price-list-only parts as product pages:** Dinamik codes without a stock-list row that carry an enrichment matched to their code and brand and a category with a Turkish label become unavailable cards named after that category ("Stok bilgisi bekleniyor", "Gelince haber ver", no price). Unlike other unavailable cards they are indexed and listed in the sitemap and IndexNow; never in the merchant feed, never orderable. Kept in `storefront_price_only_items` by `storefront_price_only_refresh()` ([#1068](https://github.com/aokcuoglu/getirbakim/issues/1068)).
- **Amazon SES mail transport:** `MAIL_TRANSPORT=ses` sends order emails through the SES v2 API with the ECS task role (no SMTP credentials); region from `SES_REGION` / `AWS_REGION` ([#1064](https://github.com/aokcuoglu/getirbakim/pull/1064), [#1062](https://github.com/aokcuoglu/getirbakim/issues/1062)).

### Fixed
- **Supplier quality guard on small lists:** a rise of more than 10 points in missing stock/price now also needs at least 5 products to lose that data; 27-product Dinamik lists losing 3 stock rows were rejected every night and kept the supplier-sync alarm open ([#1067](https://github.com/aokcuoglu/getirbakim/pull/1067), [#1066](https://github.com/aokcuoglu/getirbakim/issues/1066)).
- **Dinamik circuit breaker per brand:** one brand's HTTP 5xx or timeout (HELLA `getStockList` 500) no longer skips every remaining Dinamik brand in the tick; the breaker opens after 3 consecutive upstream failures, or immediately on 401/403, config or busy ([#1072](https://github.com/aokcuoglu/getirbakim/pull/1072), [#1071](https://github.com/aokcuoglu/getirbakim/issues/1071)).
- Signed-in accounts without a service discount are no longer told to order without signing up at checkout ([#1070](https://github.com/aokcuoglu/getirbakim/pull/1070)).

### Changed
- `vehicle_brands.popular` dropped (unused since #949; guarded `DO` block, runs once) ([#1026](https://github.com/aokcuoglu/getirbakim/pull/1026), [#944](https://github.com/aokcuoglu/getirbakim/issues/944)). Safe because v0.32.x, live on AWS, no longer reads the column.

### Deploy and operations
- `db:setup` drops `vehicle_brands.popular` once; no other schema change. Vehicle oil specs are unchanged.
- SES: `MAIL_TRANSPORT`, `MAIL_FROM`, `MAIL_REPLY_TO` app secret keys are wired by getirbakim-infra#7 and present in the app secret.
- Geliver sync is enabled with this release (`PRODUCTION_GELIVER_SYNC_ENABLED=true` in the GitHub variables and the operator `.env`).
- Release with `gh workflow run release-aws.yml --ref main -f version=0.33.0`.

### Deploy and operations
- `db:setup` creates `storefront_price_only_items` (first run only: `SHARE ROW EXCLUSIVE` on `supplier_items` for its foreign key until setup commits, as for earlier tables referencing it), replaces `commerce_unavailable_items`, `storefront_catalog_entries` and `storefront_catalog` (new `price_only` column at the end) and fills the list once; the app keeps it current afterwards ([#1068](https://github.com/aokcuoglu/getirbakim/issues/1068)).

## v0.32.1 — 2026-11-20

Patch release of `dev` since v0.32.0 (1 pull request): CI runner selection and an AWS release without the GitHub `production` environment, so the repository can go private on GitHub Free. Application code is unchanged. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Changed
- **CI runner selectable** with the repository variable `CI_RUNS_ON` (unset: GitHub-hosted `ubuntu-24.04`); Postgres starts with `docker run` on a free localhost port and is always removed; Mac runner setup in `scripts/ci/mac-runner-setup.sh` and `docs/ci-mac-runner.md` ([#1053](https://github.com/aokcuoglu/getirbakim/pull/1053), [#1047](https://github.com/aokcuoglu/getirbakim/issues/1047)).
- **`release-aws.yml` without the `production` environment:** started with `-f version=<package.json version>`; a guard job (main, owner as actor and triggering actor, matching version) and the same branch/actor check as the first step of the release job stop everything before AWS ([#1053](https://github.com/aokcuoglu/getirbakim/pull/1053)).

### Deploy and operations
- Done before this release: getirbakim-infra#6 (release role trusts `release-aws.yml` on main via `job_workflow_ref`), repository OIDC subject template (`repo`, `context`, `job_workflow_ref`), release variables and `INFRA_DEPLOY_KEY` at repository level.
- Release with `gh workflow run release-aws.yml --ref main -f version=0.32.1`. After it succeeds: the repository can go private, then register the Mac runner and set `CI_RUNS_ON` (`docs/ci-mac-runner.md`); afterwards drop the environment subjects from the release role trust.
- No schema change; `db:setup` is a no-op. Vehicle oil specs are unchanged.

## v0.32.0 — 2026-11-20

Release of `dev` since v0.31.0 (12 pull requests). Unblocks the AWS release: v0.31.0's `db:setup` deadlocked with live storefront reads, so v0.31.0 never reached production and ships to AWS with this version. Also: order confirmation email, partner invoiced-mark correction, multi-window Turkish type-name search, single-row supplier currency anomalies kept out of pricing.

### Added
- **Order confirmation email** after payment, logged per order ([#1033](https://github.com/aokcuoglu/getirbakim/pull/1033)); sent only once SMTP is configured (see below).
- **Partner invoices:** correct or undo an invoiced mark from `/yonetim` ([#1031](https://github.com/aokcuoglu/getirbakim/pull/1031)); server reasons shown in the invoice dialogs ([#1044](https://github.com/aokcuoglu/getirbakim/pull/1044)).
- **Search:** several Turkish type-name windows translated together, with their first-page share recorded ([#1032](https://github.com/aokcuoglu/getirbakim/pull/1032)).
- **Suppliers:** single-row currency anomalies kept out of pricing ([#1052](https://github.com/aokcuoglu/getirbakim/pull/1052)).
- **Platform:** the production DB tunnel defaults to a read-only role ([#1041](https://github.com/aokcuoglu/getirbakim/pull/1041)); it exits 0 when its task is stopped ([#1051](https://github.com/aokcuoglu/getirbakim/pull/1051)).

### Changed
- **Performance:** header sheets, account panel and cookie settings load on first intent ([#1040](https://github.com/aokcuoglu/getirbakim/pull/1040)).
- Legacy unconfirmed stock label removed ([#1025](https://github.com/aokcuoglu/getirbakim/pull/1025)); GA4 purchase value excludes the installment fee (docs, [#1024](https://github.com/aokcuoglu/getirbakim/pull/1024)).

### Fixed
- - **`db:setup` no longer deadlocks with storefront reads when nested views change** ([#1046](https://github.com/aokcuoglu/getirbakim/issues/1046)): v0.31.0's `release-aws` failed all 6 attempts with 40P01 because setup replaced `commerce_catalog_entries` before `storefront_catalog_entries` while storefront queries lock them outer first. A view replace or an ALTER TABLE now first locks the views that read it, outermost first (`setup_lock_dependent_views`, base tables untouched); a no-op run still takes no locks. Dependent views the setup role cannot alter are skipped with a NOTICE instead of failing. `supplier_items_brand_label_idx` is built `CONCURRENTLY` before the schema transaction (an INVALID leftover is rebuilt; 40P01/55P03 retried 3 times, progress logged); the build waits for every open transaction that could still see `supplier_items`, so a long-running transaction delays `db:setup` (it does not block reads or writes). ([#1055](https://github.com/aokcuoglu/getirbakim/pull/1055))
- Mobile category sheet footer shows the session ([#1045](https://github.com/aokcuoglu/getirbakim/pull/1045)).

### Deploy and operations
- **Includes v0.31.0's deploy steps** (v0.31.0 was never released to AWS): `db:setup` before the new code, environment keys and CloudFront changes. The 12 new app secret keys (Geliver, partner orders, tags), the `geliver-sync` schedule (off) and CloudFront viewer headers are in getirbakim-infra#4; Geliver token, mode `live`, webhook secret, partner quote secret and the 100 TL default partner limit are set; the Geliver webhook is registered.
- `db:setup` builds `supplier_items_brand_label_idx` `CONCURRENTLY` before its transaction; watch the `release-aws` log for "Built index" and no "hit a lock conflict" retries. Follow-up: #1054.
- **After deploy:** refresh Başbuğ (or the BMW group) once from the panel so the new currency-anomaly table is filled ([#1052](https://github.com/aokcuoglu/getirbakim/pull/1052)); run the Geliver webhook test; enable `PRODUCTION_GELIVER_SYNC_ENABLED` once Geliver is live.
- **Order email ([#1033](https://github.com/aokcuoglu/getirbakim/pull/1033)):** until `MAIL_TRANSPORT=smtp`, `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` reach the task (SES domain verification, port 587 egress), each order logs a `skipped` row.
- Read-only tunnel role: create once on production per `docs/aws-db-tunnel.md` ([#1041](https://github.com/aokcuoglu/getirbakim/pull/1041)).
- Vehicle oil specs are unchanged. Local: `npm run db:setup` after merging.

## v0.31.0 — 2026-11-19

Release of `dev` since v0.30.0 (43 pull requests): separate invoice address and account address book, Turkish names and Turkish search for English-named supplier products, Yurtiçi labels through Geliver, partner orders, Google Ads / Meta Pixel behind consent, faster brand and listing pages, lighter storefront and lock-free `db:setup`. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Added
- **Checkout:** separate invoice address ([#982](https://github.com/aokcuoglu/getirbakim/pull/982)); VKN check digit validation ([#936](https://github.com/aokcuoglu/getirbakim/pull/936)); the order line and agreement carry the product name the cart shows ([#996](https://github.com/aokcuoglu/getirbakim/pull/996)).
- **Account address book** under `/hesap/adresler` for approved service and admin accounts (max 10, default delivery/invoice), prefilling checkout ([#1005](https://github.com/aokcuoglu/getirbakim/pull/1005)).
- **Turkish names for English supplier type names** on cards, product pages, cart and feeds; slugs follow, old URLs 308 + IndexNow ([#958](https://github.com/aokcuoglu/getirbakim/pull/958)).
- **Search:** Turkish queries find English-named supplier products ([#970](https://github.com/aokcuoglu/getirbakim/pull/970)), exact single-word type names ([#976](https://github.com/aokcuoglu/getirbakim/pull/976)), Turkish-name ranking and suffixed forms ([#998](https://github.com/aokcuoglu/getirbakim/pull/998)), Turkish type-ahead suggestions ([#1016](https://github.com/aokcuoglu/getirbakim/pull/1016)).
- **Shipping:** Yurtiçi labels through Geliver with webhook tracking ([#980](https://github.com/aokcuoglu/getirbakim/pull/980), [#984](https://github.com/aokcuoglu/getirbakim/pull/984)) and a periodic sync for missed webhooks ([#1003](https://github.com/aokcuoglu/getirbakim/pull/1003)).
- **Partner (BakımX) orders:** quotes and on-account orders ([#1004](https://github.com/aokcuoglu/getirbakim/pull/1004)), cancellation and admin cancel requests ([#1013](https://github.com/aokcuoglu/getirbakim/pull/1013)), credit limits, exposure and invoiced marks ([#1019](https://github.com/aokcuoglu/getirbakim/pull/1019)).
- **Google Ads conversion and Meta Pixel** behind the marketing consent ([#972](https://github.com/aokcuoglu/getirbakim/pull/972)).
- **Platform:** Session Manager tunnel to the production database ([#938](https://github.com/aokcuoglu/getirbakim/pull/938)); parts2world type dictionary through the egress proxy ([#948](https://github.com/aokcuoglu/getirbakim/pull/948)).

### Changed
- **Performance:** manufacturer/brand listings through a brand label index ([#961](https://github.com/aokcuoglu/getirbakim/pull/961)); property facet driven from small listing scopes ([#997](https://github.com/aokcuoglu/getirbakim/pull/997)); enrichment queue, run selection, requeue and status read `enrichment_product_states` ([#941](https://github.com/aokcuoglu/getirbakim/pull/941), [#947](https://github.com/aokcuoglu/getirbakim/pull/947)).
- **Storefront weight:** product fitment capped at 20 groups with the rest loaded on demand from a compressed, cacheable API ([#973](https://github.com/aokcuoglu/getirbakim/pull/973), [#1000](https://github.com/aokcuoglu/getirbakim/pull/1000), [#1012](https://github.com/aokcuoglu/getirbakim/pull/1012)); home classes moved to the stylesheet ([#995](https://github.com/aokcuoglu/getirbakim/pull/995)); zod kept out of the storefront bundle and the listing card CSS folded into the main stylesheet ([#1020](https://github.com/aokcuoglu/getirbakim/pull/1020)).
- **`db:setup` takes no blocking locks on a second run:** unchanged constraints, columns, views, indexes and triggers are skipped ([#959](https://github.com/aokcuoglu/getirbakim/pull/959), [#971](https://github.com/aokcuoglu/getirbakim/pull/971), [#992](https://github.com/aokcuoglu/getirbakim/pull/992), [#1011](https://github.com/aokcuoglu/getirbakim/pull/1011)); scripts and the bundle import check the schema instead of applying DDL ([#937](https://github.com/aokcuoglu/getirbakim/pull/937), [#943](https://github.com/aokcuoglu/getirbakim/pull/943)).
- Popular vehicle makes from a single source ([#945](https://github.com/aokcuoglu/getirbakim/pull/945)); `vehicle_brands.popular` no longer read or written ([#949](https://github.com/aokcuoglu/getirbakim/pull/949)); safe-area insets with `viewport-fit=cover` ([#942](https://github.com/aokcuoglu/getirbakim/pull/942)); dead listing CSS removed ([#935](https://github.com/aokcuoglu/getirbakim/pull/935)); VPS storefront sync target removed ([#991](https://github.com/aokcuoglu/getirbakim/pull/991)).

### Fixed
- Header search type selector visible between 600 and 850px ([#983](https://github.com/aokcuoglu/getirbakim/pull/983)); catalog toolbar no longer overflows at 768px ([#990](https://github.com/aokcuoglu/getirbakim/pull/990)); home hero flush under the header ([#978](https://github.com/aokcuoglu/getirbakim/pull/978)).
- Tests: `pg_trgm` created in `public` before isolated schemas ([#988](https://github.com/aokcuoglu/getirbakim/pull/988)); Geliver webhook verification notes ([#1001](https://github.com/aokcuoglu/getirbakim/pull/1001)).

### Deploy and operations
- **`db:setup` is required and must run before the new code:** invoice address columns ([#982](https://github.com/aokcuoglu/getirbakim/pull/982)), `account_addresses` ([#1005](https://github.com/aokcuoglu/getirbakim/pull/1005)), `brand_label` view column and indexes ([#961](https://github.com/aokcuoglu/getirbakim/pull/961)), Geliver shipments ([#980](https://github.com/aokcuoglu/getirbakim/pull/980)), partner order columns ([#1004](https://github.com/aokcuoglu/getirbakim/pull/1004), [#1013](https://github.com/aokcuoglu/getirbakim/pull/1013), [#1019](https://github.com/aokcuoglu/getirbakim/pull/1019)); `release-aws` runs it first. First run takes short locks on `commerce_orders` and `accounts` (partner columns, address book FK); later runs are lock-free.
- **Brand label index ([#961](https://github.com/aokcuoglu/getirbakim/pull/961)):** created inside `db:setup` it holds a SHARE lock on `supplier_items` while catalog views change in the same transaction (est. 20–60 s on RDS). Recommended before deploy: `CREATE INDEX CONCURRENTLY IF NOT EXISTS supplier_items_brand_label_idx ON supplier_items(supplier_item_brand(supplier,product_data)); ANALYZE supplier_items;`
- **Environment (partner infra):** Geliver — `GELIVER_API_TOKEN`, `GELIVER_MODE=live`, `GELIVER_WEBHOOK_SECRET`, balance top-up, register the webhook once after go-live, schedule `npm run geliver:sync` every 2–4 h ([#980](https://github.com/aokcuoglu/getirbakim/pull/980), [#1003](https://github.com/aokcuoglu/getirbakim/pull/1003); secret rotation #975). Partner orders — `PARTNER_QUOTE_SIGNING_SECRET`, `PARTNER_ORDER_LIMIT_KURUS`, CloudFront forwards `cloudfront-viewer-address`; send contract v2.0 to BakımX; mark already delivered partner orders "Faturalandı" ([#1004](https://github.com/aokcuoglu/getirbakim/pull/1004), [#1019](https://github.com/aokcuoglu/getirbakim/pull/1019)). Ads/Pixel — `GOOGLE_ADS_ID`, `GOOGLE_ADS_PURCHASE_LABEL`, `META_PIXEL_ID` with this release (consent version 3), Enhanced conversions / Automatic Advanced Matching off ([#972](https://github.com/aokcuoglu/getirbakim/pull/972)).
- **CloudFront:** `/api/product-fitments/*` and `/api/categories` are compressed by the app; forward `Accept-Encoding`; if caching is enabled later, key on the query string and normalized encoding, not cookies (partner note `data/partner/cloudfront-product-fitments-1008.pdf`).
- **Turkish names ([#958](https://github.com/aokcuoglu/getirbakim/pull/958)):** ~4.1k product URLs change; old URLs 308 and IndexNow reports both.
- **Privacy texts:** checkout now stores invoice addresses and the address book stores third-party addresses; the updated privacy/KVKK texts are pending legal review (#1010, not in this release).
- `vehicle_brands.popular` can be dropped in the next release (#944). Vehicle oil specs are unchanged.
- Local only: after `db:setup`, restart the enrichment workers from the current checkout.

## v0.30.0 — 2026-11-17

Release of `dev` since v0.29.0 (41 pull requests): mobile storefront, structured checkout address and TAMI installments, product feed, hidden-OEM data rules, enrichment tombstones and admin tooling. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Added
- **Mobile storefront:** consistent header with 44px controls and clean search suggestions ([#895](https://github.com/aokcuoglu/getirbakim/pull/895)); listing with products first, compact grid cards and honest stock/fitment badges ([#901](https://github.com/aokcuoglu/getirbakim/pull/901)); product page sticky purchase bar ([#892](https://github.com/aokcuoglu/getirbakim/pull/892)); cart and checkout with sticky total bar ([#887](https://github.com/aokcuoglu/getirbakim/pull/887)); home and vehicle picker polish ([#906](https://github.com/aokcuoglu/getirbakim/pull/906)); filter bottom sheet with result count and removable chips ([#920](https://github.com/aokcuoglu/getirbakim/pull/920)).
- **Garage-vehicle fits first** on listings and search ([#927](https://github.com/aokcuoglu/getirbakim/pull/927)).
- **Checkout:** structured delivery address (il/ilçe) and invoice details ([#907](https://github.com/aokcuoglu/getirbakim/pull/907)); payment options with installment fee on the TAMI hosted page, off until enabled in the panel ([#897](https://github.com/aokcuoglu/getirbakim/pull/897)); installment payments flagged ([#875](https://github.com/aokcuoglu/getirbakim/pull/875)).
- **Google Merchant / Meta product feed** ([#904](https://github.com/aokcuoglu/getirbakim/pull/904)).
- **Content:** guide section, real FAQ and expanded about page ([#863](https://github.com/aokcuoglu/getirbakim/pull/863)); founding year on the about page and Organization JSON-LD ([#872](https://github.com/aokcuoglu/getirbakim/pull/872)).
- **Hidden supplier OEM:** no longer forms OEM equivalents ([#868](https://github.com/aokcuoglu/getirbakim/pull/868)) and OEM-matched enrichment (fitments, specs, images, category placement) is ignored while hidden ([#903](https://github.com/aokcuoglu/getirbakim/pull/903), [#930](https://github.com/aokcuoglu/getirbakim/pull/930)).
- **Enrichment tombstones:** locally deleted enrichments are removed on AWS by the storefront sync ([#889](https://github.com/aokcuoglu/getirbakim/pull/889)).
- **Categories:** spareto via the Trodo tree ([#853](https://github.com/aokcuoglu/getirbakim/pull/853)), parts2world via TecDoc part type ([#854](https://github.com/aokcuoglu/getirbakim/pull/854)), held backfills released in one batch ([#856](https://github.com/aokcuoglu/getirbakim/pull/856)), curated part-type aliases and manual mappings ([#867](https://github.com/aokcuoglu/getirbakim/pull/867)).
- **Admin:** manual product list price, discount and stock editing ([#891](https://github.com/aokcuoglu/getirbakim/pull/891)); all manual lists in one bulk CSV ([#905](https://github.com/aokcuoglu/getirbakim/pull/905)); paginated bulk CSV drafts ([#874](https://github.com/aokcuoglu/getirbakim/pull/874)); list price and discount columns in the xlsx template ([#864](https://github.com/aokcuoglu/getirbakim/pull/864)); partial fitment copy by model/brand with a 1000 decision limit ([#890](https://github.com/aokcuoglu/getirbakim/pull/890)); grouped/paged fitment history with one-step undo of a bulk add or copy ([#870](https://github.com/aokcuoglu/getirbakim/pull/870)); price ratio and pack hints on suffix candidates ([#919](https://github.com/aokcuoglu/getirbakim/pull/919)).

### Changed
- Listing pages show 24 products ([#862](https://github.com/aokcuoglu/getirbakim/pull/862)).
- Live checkout check: refuses sold-out or repriced lines, bounded Dinamik check, judged by sale price with a shared sale-price formula ([#866](https://github.com/aokcuoglu/getirbakim/pull/866), [#885](https://github.com/aokcuoglu/getirbakim/pull/885), [#926](https://github.com/aokcuoglu/getirbakim/pull/926)).
- Supplier sync: a list that only adds products without stock/price rows is no longer rejected ([#858](https://github.com/aokcuoglu/getirbakim/pull/858)); a daily list's quality rejection waits for its next daily run and alarms once ([#917](https://github.com/aokcuoglu/getirbakim/pull/917)).
- Enrichment worker startup and pending selection no longer block `/yonetim/urun-verileri` ([#928](https://github.com/aokcuoglu/getirbakim/pull/928)); matcher locks scoped per schema ([#859](https://github.com/aokcuoglu/getirbakim/pull/859)).

### Fixed
- Storefront export retries media reads on local MinIO clock skew ([#909](https://github.com/aokcuoglu/getirbakim/pull/909)).
- Model years in the fitment copy picker; brand named once in product titles ([#896](https://github.com/aokcuoglu/getirbakim/pull/896)).
- Tests and docs: Dinamik budget test clock ([#922](https://github.com/aokcuoglu/getirbakim/pull/922)), TopluMalzemeAra findings ([#918](https://github.com/aokcuoglu/getirbakim/pull/918)), suffix second-signal measurement ([#900](https://github.com/aokcuoglu/getirbakim/pull/900)).

### Deploy and operations
- **`db:setup` is required and must run before the new code** (columns for [#907](https://github.com/aokcuoglu/getirbakim/pull/907) / [#897](https://github.com/aokcuoglu/getirbakim/pull/897), views for [#901](https://github.com/aokcuoglu/getirbakim/pull/901) / [#903](https://github.com/aokcuoglu/getirbakim/pull/903) / [#930](https://github.com/aokcuoglu/getirbakim/pull/930), tombstone table and triggers for [#889](https://github.com/aokcuoglu/getirbakim/pull/889)); `release-aws` runs it first. Vehicle oil specs are unchanged.
- **Hidden OEM ([#903](https://github.com/aokcuoglu/getirbakim/pull/903)) applies retroactively:** products whose supplier OEM is already hidden on AWS lose OEM-matched fitments/specs/images/category placement unless another valid source exists.
- **Tombstones ([#889](https://github.com/aokcuoglu/getirbakim/pull/889)):** deletions sent before this release are applied by the first storefront sync after it. Check `npm run storefront:sync -- --dry-run` (`tombstones`); the cap is 1000 (`--max-deletions`).
- **Installments ([#897](https://github.com/aokcuoglu/getirbakim/pull/897)):** stay off until enabled in the panel; finish the legal text (#893) first.
- **Product feed ([#904](https://github.com/aokcuoglu/getirbakim/pull/904)):** needs operations env (`APP_ENV`, `SITE_URL`, `S3_BUCKET`, `S3_REGION`), IAM on `feeds/*`, CloudFront `/feeds/*`, WAF allowance for Merchant Center / `facebookexternalhit`, and a 4×/day schedule; first run with `--dry-run`. Merchant Center domain claim, shipping and return policy at account level.
- Local only: after `db:setup`, restart the enrichment workers from the current checkout (they re-apply `db/enrichment-products.sql`); category backfills of [#853](https://github.com/aokcuoglu/getirbakim/pull/853) / [#854](https://github.com/aokcuoglu/getirbakim/pull/854) / [#856](https://github.com/aokcuoglu/getirbakim/pull/856) are released locally on a chosen night and reach AWS through `storefront:sync`.

## v0.29.0 — 2026-11-16

Release of `dev` since v0.28.0 (31 pull requests): search synonyms and analytics, manual bulk CSV and admin tooling. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Added
- **Search synonyms:** auto-parts synonym groups and multi-word synonyms ([#820](https://github.com/aokcuoglu/getirbakim/pull/820)); search analytics and admin-managed synonyms at `/yonetim/arama` ([#827](https://github.com/aokcuoglu/getirbakim/pull/827)); AI-suggested synonyms with an approval queue ([#835](https://github.com/aokcuoglu/getirbakim/pull/835)); reviewed AI synonym groups and Turkish consonant softening ([#847](https://github.com/aokcuoglu/getirbakim/pull/847)).
- **Manual supplier bulk CSV:** export/import of manual product prices, discounts, margins and stock ([#837](https://github.com/aokcuoglu/getirbakim/pull/837)).
- **Admin tooling:** master brand logos on the product matching page ([#836](https://github.com/aokcuoglu/getirbakim/pull/836)); select a whole model and copy fitments from another product ([#813](https://github.com/aokcuoglu/getirbakim/pull/813)); convert an automatic image into an upload and drag to reorder ([#804](https://github.com/aokcuoglu/getirbakim/pull/804)); hide unlinked source vehicle rows and model-level fitments per product ([#806](https://github.com/aokcuoglu/getirbakim/pull/806)).
- Sticky listing filter sidebar ([#807](https://github.com/aokcuoglu/getirbakim/pull/807)); admin edits and description fitments move sitemap `lastmod` and the IndexNow fingerprint ([#801](https://github.com/aokcuoglu/getirbakim/pull/801)); GA4 `refund` event once for cancelled paid orders ([#799](https://github.com/aokcuoglu/getirbakim/pull/799)).

### Changed
- Checkout: `submitOrder` no longer waits on supplier rows a list import holds ([#828](https://github.com/aokcuoglu/getirbakim/pull/828)); model sitemap caches warmed in the app process ([#797](https://github.com/aokcuoglu/getirbakim/pull/797)).
- Database tests no longer depend on try-locks or the dev server's matcher lock ([#793](https://github.com/aokcuoglu/getirbakim/pull/793), [#830](https://github.com/aokcuoglu/getirbakim/pull/830)).

### Fixed
- Vehicle oil filters read the manual supplier's oil specifications (`Viskozite`, `Onaylar ve normlar`), so approvals such as Renault RN17 match ([#845](https://github.com/aokcuoglu/getirbakim/pull/845)).
- Codes like 5W-40 / 5W40 / 5w 40 match with any separator ([#814](https://github.com/aokcuoglu/getirbakim/pull/814)); synonym suggestions skip what the parser already matches by prefix ([#839](https://github.com/aokcuoglu/getirbakim/pull/839)).
- Master brand name shown instead of the supplier's raw label ([#824](https://github.com/aokcuoglu/getirbakim/pull/824)); Dinamik cost applies dealer discounts and the campaign rate ([#810](https://github.com/aokcuoglu/getirbakim/pull/810)).
- Checkout live-check follow-ups: dropped codes refused, shorter lock wait, per-row Dinamik fallback ([#800](https://github.com/aokcuoglu/getirbakim/pull/800)); GA4 `item_id` is the listing id ([#796](https://github.com/aokcuoglu/getirbakim/pull/796)).
- Storefront header and 600px breakpoint overflows ([#821](https://github.com/aokcuoglu/getirbakim/pull/821), [#833](https://github.com/aokcuoglu/getirbakim/pull/833)); Bakım Robotu link hidden on the phone home header ([#794](https://github.com/aokcuoglu/getirbakim/pull/794)); supplier-neutral note on the admin order page ([#791](https://github.com/aokcuoglu/getirbakim/pull/791)); description fitments keep `derived_at` when unchanged ([#831](https://github.com/aokcuoglu/getirbakim/pull/831)).
- Docs: SEO/GEO playbook and AWS requirements ([#826](https://github.com/aokcuoglu/getirbakim/pull/826)), cookie policy mentions purchase measurement ([#823](https://github.com/aokcuoglu/getirbakim/pull/823)), Dinamik AWS egress IP ([#803](https://github.com/aokcuoglu/getirbakim/pull/803)).

### Deploy and operations
- `db/*.sql`: new idempotent tables and functions (search analytics, synonyms and AI suggestions, manual supplier bulk CSV, fitment/commerce columns); `db:setup` runs as part of the AWS release. Search ranking changed only in functions, no REINDEX. Vehicle oil specs are unchanged.
- **AI synonym suggestions (#835):** add an `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) secret to the AWS app; without it the tab shows an info notice.
- **IndexNow (#801):** if live, run `npm run seo:indexnow -- --dry-run --limit=0` as an operations task after the release; if `changed` is large, run `--seed` once.
- v0.28.0's operations notes still apply if both are released together (writable `.next/cache`, `verify:fitment --drift-only`, cookie policy before GA4).

## v0.28.0 — 2026-11-16

Release of `dev` since v0.27.0 (22 pull requests): manufacturer and model × category pages, links from products to model pages, and a faster storefront. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Added
- **Manufacturer pages** at `/marka/<slug>` listing every supplier label of a master brand; indexable from 10 products, non-manufacturer groups (orijinal, taiwan, korea…) `noindex`; `manufacturers.xml` sitemap; `/katalog?brand=` 301s to the manufacturer page ([#776](https://github.com/aokcuoglu/getirbakim/pull/776)).
- **Model × category pages** (`/kategori/<kategori>/<marka>/<model>`), a thin-content gate for model, model × category and make × category listings (1–9 products `noindex`, 0 products 404), only non-empty categories on make and model pages, `models.xml` and `model-categories.xml` sitemaps ([#781](https://github.com/aokcuoglu/getirbakim/pull/781)).
- **Links from fitments to model pages**, model summary with image, body types and engine codes, a motorcycle section on make pages, Turkish market names (Egea, Symbol, Clio Symbol, Accent Era, Accent Blue); make listings now include description fitments ([#779](https://github.com/aokcuoglu/getirbakim/pull/779)).
- **Product short description** under the product title, editable in the admin, used in the meta description ([#765](https://github.com/aokcuoglu/getirbakim/pull/765)).
- Admin-entered content (name, description, short description, images, specs, references, added vehicles) counts as an indexing signal ([#768](https://github.com/aokcuoglu/getirbakim/pull/768)).
- Engine-oil filter honours admin specification overrides ([#761](https://github.com/aokcuoglu/getirbakim/pull/761)); equivalent search also matches enrichment OEM numbers ([#753](https://github.com/aokcuoglu/getirbakim/pull/753)); warning before leaving a product tab with unsaved input ([#748](https://github.com/aokcuoglu/getirbakim/pull/748)).
- Cart and checkout funnel events with an exactly-once GA4 `purchase` ([#754](https://github.com/aokcuoglu/getirbakim/pull/754)); per-code Başbuğ checkout check with a marked fallback when a supplier API fails ([#769](https://github.com/aokcuoglu/getirbakim/pull/769)); clearer order detail and payment screens ([#746](https://github.com/aokcuoglu/getirbakim/pull/746)).

### Changed
- Performance: mobile LCP 6.4 s → 1.8 s on the home page and 1.5–1.8 s on category pages (Inter subsets, sized and preloaded hero images, cookie banner rendered on the server) ([#783](https://github.com/aokcuoglu/getirbakim/pull/783)); product and category images through Next image optimization (home images 4.9 MB → 0.14–0.35 MB) ([#772](https://github.com/aokcuoglu/getirbakim/pull/772)); catalog card and header/footer classes moved to component CSS (listings −121 to −144 KB HTML) ([#780](https://github.com/aokcuoglu/getirbakim/pull/780)); price-sorted listings cache their first pages' order ([#779](https://github.com/aokcuoglu/getirbakim/pull/779)).
- Storefront sync rebuilds fitments only for the products in the bundle plus outdated matcher versions; `verify:fitment --drift-only` added ([#762](https://github.com/aokcuoglu/getirbakim/pull/762)).
- Database tests no longer depend on the shared-links try-lock ([#760](https://github.com/aokcuoglu/getirbakim/pull/760)).

### Fixed
- Font-swap layout shift on catalog and category pages; Android Roboto fallback metrics; `/kategori/yag` mobile filter-panel shift ([#756](https://github.com/aokcuoglu/getirbakim/pull/756), [#777](https://github.com/aokcuoglu/getirbakim/pull/777)).
- Cart dialog suggestions no longer offer parts of the same type ([#747](https://github.com/aokcuoglu/getirbakim/pull/747)); TAMI popup returns on local dev ([#745](https://github.com/aokcuoglu/getirbakim/pull/745)).
- Spareto checkpoint streamed so it no longer runs out of memory ([#758](https://github.com/aokcuoglu/getirbakim/pull/758)); deterministic purchase-event test ([#775](https://github.com/aokcuoglu/getirbakim/pull/775)).

### Deploy and operations
- `db/*.sql`: two idempotent nullable columns (`product_overrides.short_description`, #754's commerce column); `db:setup` runs as part of the AWS release as usual. Vehicle oil specs are unchanged.
- **Image optimization (#772):** the app task must have a writable `.next/cache` (no `readonlyRootFilesystem`, or a writable volume/tmpfs); otherwise every image is re-encoded on each request. Watch app CPU/RSS after the release; CloudFront `/_next/image*` behaviour is tracked in #633.
- **Scoped fitment rebuild (#762):** before the first storefront import after this release, run `scripts/verify-product-fitments.ts --drift-only` as an operations task; if it reports drift, run `scripts/rebuild-product-fitments.ts` once without arguments.
- **GA4 (#754):** update the cookie policy (#749) before enabling `GA4_MEASUREMENT_ID` in production.
- New sitemap files `manufacturers.xml`, `models.xml`, `model-categories.xml`; the model sitemaps take seconds on a cold cache — measure on RDS and warm them (#778). Large make/manufacturer pages are slow on a cold cache (#771).
- The cookie banner HTML now depends on the `gb_consent` cookie; if CloudFront ever caches anonymous HTML it must vary on it.

## v0.27.0 — 2026-11-15

Release of `dev` since v0.26.0 (21 pull requests): admin product page tabs, cart suggestions, and a faster storefront, cart and checkout. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Added
- **Admin product page in tabs** with equivalent search by part number, supplier code or OEM number ([#710](https://github.com/aokcuoglu/getirbakim/pull/710)).
- **Add a product image from a URL** on the admin product page ([#728](https://github.com/aokcuoglu/getirbakim/pull/728)).
- **Related suggestions in the add-to-cart dialog** and **engine oil suggestions ranked by the vehicle's oil specification** ([#727](https://github.com/aokcuoglu/getirbakim/pull/727), [#732](https://github.com/aokcuoglu/getirbakim/pull/732)).
- Catalog card specifications translated on the server with the product page dictionary ([#726](https://github.com/aokcuoglu/getirbakim/pull/726)).

### Changed
- Performance: cart lines looked up per product with cart/checkout skeletons, order line fitment levels resolved in bulk before the order transaction, order page and checkout no longer wait on TAMI and serial supplier refreshes, cart badge updated on the client, session cookie slid at most every 5 minutes, loading skeletons for orders and garage, category tree loaded on demand with lighter storefront markup ([#720](https://github.com/aokcuoglu/getirbakim/pull/720), [#718](https://github.com/aokcuoglu/getirbakim/pull/718), [#721](https://github.com/aokcuoglu/getirbakim/pull/721), [#731](https://github.com/aokcuoglu/getirbakim/pull/731), [#724](https://github.com/aokcuoglu/getirbakim/pull/724), [#714](https://github.com/aokcuoglu/getirbakim/pull/714), [#734](https://github.com/aokcuoglu/getirbakim/pull/734)).
- Valkey TTL follows `unstable_cache` revalidate ([#695](https://github.com/aokcuoglu/getirbakim/pull/695)).
- One shared enrichment validity gate ([#723](https://github.com/aokcuoglu/getirbakim/pull/723)).
- `release-aws.yml` reads the AWS release configuration from the `production` environment variables ([#730](https://github.com/aokcuoglu/getirbakim/pull/730)).

### Fixed
- Product page: brand and product code shown separately and dropped from the title; specification labels and values translated; one row per label ([#713](https://github.com/aokcuoglu/getirbakim/pull/713), [#701](https://github.com/aokcuoglu/getirbakim/pull/701), [#722](https://github.com/aokcuoglu/getirbakim/pull/722)).
- Catalog sidebar facet values translated and merged ([#717](https://github.com/aokcuoglu/getirbakim/pull/717)).
- Home category rails and card labels follow the admin's category ([#696](https://github.com/aokcuoglu/getirbakim/pull/696)).
- Picking a vehicle keeps the previous one in the garage ([#706](https://github.com/aokcuoglu/getirbakim/pull/706)).

### Deploy and operations
- No `db/*.sql` change since v0.26.0; `db:setup` runs as part of the AWS release as usual. Vehicle oil specs are unchanged.
- Adding an image from a URL (#725) needs HTTP(S) egress from the app task to the internet; without it the admin sees "Adrese ulaşılamadı".
- New required cookie `gb_session_at` (#716, cookie policy updated). During a rolling deploy a user idle for 25–30 minutes may be signed out about 5 minutes early.
- New public `GET /api/categories` (`Cache-Control: public, s-maxage=3600`); `/api/categories` and `/api/*-media` no longer set the session cookie. If CloudFront caches app responses, responses with `Set-Cookie` must never be cached.
- No new secrets or environment variables for the app; the release workflow's configuration lives in the GitHub `production` environment (#730).

## v0.26.0 — 2026-11-15

Release of `dev` since v0.25.0 (52 pull requests): storefront SEO and GEO, per-product editing in the admin, and payments and order handling. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Added
- **SEO and GEO foundation**: site-wide metadata (title template, canonicals, icons, site JSON-LD), robots policy with AI crawler rules, `llms.txt` and `noindex` on private pages, Product/Offer, BreadcrumbList and ItemList structured data, indexing supplier products only with minimum content, primary product image as the share image ([#651](https://github.com/aokcuoglu/getirbakim/pull/651), [#648](https://github.com/aokcuoglu/getirbakim/pull/648), [#657](https://github.com/aokcuoglu/getirbakim/pull/657), [#665](https://github.com/aokcuoglu/getirbakim/pull/665), [#624](https://github.com/aokcuoglu/getirbakim/pull/624)).
- **Readable addresses and names**: Turkish path URLs for category and make pages with 301s; readable product names with search title/description templates; product URLs with a slug before the id (old addresses 308 to the new one) ([#669](https://github.com/aokcuoglu/getirbakim/pull/669), [#679](https://github.com/aokcuoglu/getirbakim/pull/679), [#682](https://github.com/aokcuoglu/getirbakim/pull/682)).
- **Vehicle model landing pages** at `/yedek-parca/<make>/<model>` backed by the `storefront_model_fits` summary table ([#683](https://github.com/aokcuoglu/getirbakim/pull/683)).
- **IndexNow** notifications for changed product URLs and **consent-gated GA4** with catalog e-commerce events ([#671](https://github.com/aokcuoglu/getirbakim/pull/671), [#672](https://github.com/aokcuoglu/getirbakim/pull/672)).
- **Per-product editing in `/yonetim/urunler`**: store name, description, category, visibility and SEO; images (upload, order, hide); OEM, cross-reference and EAN numbers; technical specifications; store brand and part number; hiding the supplier OEM field; vehicle fitments (add/remove); fixed and campaign prices over the supplier formula ([#593](https://github.com/aokcuoglu/getirbakim/pull/593), [#599](https://github.com/aokcuoglu/getirbakim/pull/599), [#613](https://github.com/aokcuoglu/getirbakim/pull/613), [#626](https://github.com/aokcuoglu/getirbakim/pull/626), [#618](https://github.com/aokcuoglu/getirbakim/pull/618), [#652](https://github.com/aokcuoglu/getirbakim/pull/652), [#678](https://github.com/aokcuoglu/getirbakim/pull/678), [#600](https://github.com/aokcuoglu/getirbakim/pull/600)).
- **Payments and orders**: refund and void TAMI payments from the admin, checkout consent with an order-specific contract copy, carrier and tracking on shipment, customer cancellation of unpaid and unconfirmed orders, supplier/warehouse/cost and procurement state per order line ([#629](https://github.com/aokcuoglu/getirbakim/pull/629), [#612](https://github.com/aokcuoglu/getirbakim/pull/612), [#621](https://github.com/aokcuoglu/getirbakim/pull/621), [#670](https://github.com/aokcuoglu/getirbakim/pull/670), [#663](https://github.com/aokcuoglu/getirbakim/pull/663)).
- **Product matching**: bulk merge for reviewed safe suffix patterns, who decided and kind filter in manual decisions, hand-linked offers flagged and filterable in matched groups ([#592](https://github.com/aokcuoglu/getirbakim/pull/592), [#594](https://github.com/aokcuoglu/getirbakim/pull/594), [#610](https://github.com/aokcuoglu/getirbakim/pull/610), [#614](https://github.com/aokcuoglu/getirbakim/pull/614)).
- **Platform**: incremental storefront sync to AWS from the 13 Nov baseline; app version in the footer and admin sidebar and build release/commit in `/api/health`; garbage collection of unreferenced product media ([#572](https://github.com/aokcuoglu/getirbakim/pull/572), [#630](https://github.com/aokcuoglu/getirbakim/pull/630), [#658](https://github.com/aokcuoglu/getirbakim/pull/658), [#632](https://github.com/aokcuoglu/getirbakim/pull/632)).

### Changed
- Performance: indexed enrichment OEM numbers for storefront code search, `/yonetim/urun-verileri` search through indexed id sets, paged vehicle matches in the enrichment dialog, per-offer fitment donor lookups ([#616](https://github.com/aokcuoglu/getirbakim/pull/616), [#625](https://github.com/aokcuoglu/getirbakim/pull/625), [#579](https://github.com/aokcuoglu/getirbakim/pull/579), [#588](https://github.com/aokcuoglu/getirbakim/pull/588)).
- Admin product edits invalidate listing caches across tasks; home rails count admin-uploaded images ([#627](https://github.com/aokcuoglu/getirbakim/pull/627), [#668](https://github.com/aokcuoglu/getirbakim/pull/668)).
- Vehicle make and model names are readable on listing pages, the model page H1 carries the year range, and the garage, vehicle picker and fitment table use the same labels; an admin's product name is shown as written ([#687](https://github.com/aokcuoglu/getirbakim/pull/687), [#688](https://github.com/aokcuoglu/getirbakim/pull/688), [#690](https://github.com/aokcuoglu/getirbakim/pull/690)).

### Fixed
- Sitemap built as a chunked index from the live catalog; admin-hidden products skipped in home rails ([#654](https://github.com/aokcuoglu/getirbakim/pull/654), [#655](https://github.com/aokcuoglu/getirbakim/pull/655)).
- `/bakim-robotu` failing for visitors with a garage vehicle ([#684](https://github.com/aokcuoglu/getirbakim/pull/684)).
- Garage button and fitment messaging follow the selected vehicle ([#681](https://github.com/aokcuoglu/getirbakim/pull/681)).
- Matching: `different` recorded on undo without a prior decision; known different-part patterns skipped in suffix candidates ([#576](https://github.com/aokcuoglu/getirbakim/pull/576), [#590](https://github.com/aokcuoglu/getirbakim/pull/590)).
- Admin: recent fetches table on narrow screens; selected tab and filters kept after refreshing matches ([#577](https://github.com/aokcuoglu/getirbakim/pull/577), [#578](https://github.com/aokcuoglu/getirbakim/pull/578)).

### Maintenance
- Local `db:setup` refuses to run from a branch behind `origin/dev`; reminder to import vehicle oil specs on AWS when the CSV changes; TAMI reconcile schedule and live payment checklist documented ([#601](https://github.com/aokcuoglu/getirbakim/pull/601), [#573](https://github.com/aokcuoglu/getirbakim/pull/573), [#620](https://github.com/aokcuoglu/getirbakim/pull/620)).

### Deploy and operations
- `scripts/setup.ts` (`db:setup`, run by the AWS release) applies every `db/*.sql` idempotently. New this release: product override tables (`product_overrides` with prices and their history, images, references, specifications, fitments), `storefront_model_fits`, `indexnow_urls`, order/payment columns and the `name_overridden` column on the catalog views. The first run creates `storefront_model_fits` and queues one full make/model fitment refresh (~1.8M rows); run it outside a supplier-sync window.
- New optional secrets: `GA4_MEASUREMENT_ID` (empty = no tag), `INDEXNOW_KEY` / `INDEXNOW_MAX_URLS` (empty = IndexNow off). If IndexNow goes live before the product URL change reaches production, run `npm run seo:indexnow -- --seed` once after it does (`docs/indexnow.md`).
- Live TAMI payments need the steps in the payment checklist (#608): reconcile schedule, CloudFront viewer address header, `PAYMENT_RECONCILIATION_SECRET`, `TAMI_CHECKOUT_ENABLED=true`, real shipping fee and free-shipping threshold.
- Vehicle oil specs (`data/vehicle_type_oil_specs.csv`) are unchanged in this release.

## v0.25.0 — 2026-11-14

Release of `dev` since v0.24.0 (63 pull requests): the AWS production runtime, supplier operations in the admin, and review tools for product matching. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Added
- **AWS production runtime** and release to AWS from GitHub Actions (`release-aws.yml`, manual `workflow_dispatch` with the `production` environment approval) ([#439](https://github.com/aokcuoglu/getirbakim/pull/439), [#466](https://github.com/aokcuoglu/getirbakim/pull/466)).
- **BakımX partner products API** restored ([#425](https://github.com/aokcuoglu/getirbakim/pull/425)).
- **Supplier operations**: refresh supplier data manually from the supplier pages; supplier feeds judged by data freshness rather than scheduler health ([#463](https://github.com/aokcuoglu/getirbakim/pull/463), [#482](https://github.com/aokcuoglu/getirbakim/pull/482)).
- **Product matching**: automatic matching refresh, merge suggestion for new brands and a pending-brand warning ([#470](https://github.com/aokcuoglu/getirbakim/pull/470)); split a single offer out of a matched group, stale-form guard, and a paged, word-searchable "Elle kararlar" view of manual decisions ([#557](https://github.com/aokcuoglu/getirbakim/pull/557)).
- **Storefront**: admin-decided equivalents on the product page; products without a supplier offer stay visible with a notify-me request ([#477](https://github.com/aokcuoglu/getirbakim/pull/477), [#478](https://github.com/aokcuoglu/getirbakim/pull/478)).
- **Enrichment**: parts2world articles reached through the supplier's OE numbers; Trodo leaves long vehicle lists and parts2world products for last ([#419](https://github.com/aokcuoglu/getirbakim/pull/419), [#428](https://github.com/aokcuoglu/getirbakim/pull/428)).

### Changed
- Bulk "Tümünü birleştir" in product matching accepts only prefix and leading-zero candidates and skips name conflicts, shared and multi-code candidates; suffix candidates need a decision one by one ([#545](https://github.com/aokcuoglu/getirbakim/pull/545)).
- `/yonetim`: one shared layout and route body for supplier pages, breadcrumb in the shell top bar with one page-header pattern, consistent states/badges/formatters, actionable items first on the dashboard, read-first supplier overview, enrichment page in tabs ([#493](https://github.com/aokcuoglu/getirbakim/pull/493), [#525](https://github.com/aokcuoglu/getirbakim/pull/525), [#544](https://github.com/aokcuoglu/getirbakim/pull/544), [#546](https://github.com/aokcuoglu/getirbakim/pull/546), [#552](https://github.com/aokcuoglu/getirbakim/pull/552), [#554](https://github.com/aokcuoglu/getirbakim/pull/554), [#555](https://github.com/aokcuoglu/getirbakim/pull/555)).
- Performance: materialized storefront enrichment links, precomputed make fitments, warm-up of the most visited pages, response compression, lighter admin layout/dashboard/supplier/enrichment/product queries and payloads, storefront chrome only on store routes, and new matching indexes ([#433](https://github.com/aokcuoglu/getirbakim/pull/433), [#447](https://github.com/aokcuoglu/getirbakim/pull/447), [#449](https://github.com/aokcuoglu/getirbakim/pull/449), [#454](https://github.com/aokcuoglu/getirbakim/pull/454), [#456](https://github.com/aokcuoglu/getirbakim/pull/456), [#501](https://github.com/aokcuoglu/getirbakim/pull/501), [#505](https://github.com/aokcuoglu/getirbakim/pull/505), [#506](https://github.com/aokcuoglu/getirbakim/pull/506), [#510](https://github.com/aokcuoglu/getirbakim/pull/510), [#511](https://github.com/aokcuoglu/getirbakim/pull/511), [#513](https://github.com/aokcuoglu/getirbakim/pull/513), [#514](https://github.com/aokcuoglu/getirbakim/pull/514), [#518](https://github.com/aokcuoglu/getirbakim/pull/518), [#522](https://github.com/aokcuoglu/getirbakim/pull/522), [#548](https://github.com/aokcuoglu/getirbakim/pull/548)).

### Fixed
- Sessions are extended while in use ([#468](https://github.com/aokcuoglu/getirbakim/pull/468)).
- Supplier sync: Dinamik duplicate and padded rows, retired Dinamik brands, Başbuğ rows that only fill empty fields, manual item saves no longer wait for a matching run ([#474](https://github.com/aokcuoglu/getirbakim/pull/474), [#492](https://github.com/aokcuoglu/getirbakim/pull/492), [#495](https://github.com/aokcuoglu/getirbakim/pull/495), [#508](https://github.com/aokcuoglu/getirbakim/pull/508), [#528](https://github.com/aokcuoglu/getirbakim/pull/528)).
- Admin: supplier page labels, errors and filters aligned; page-level auth on vehicle oils and prototype-key rejection in list filters; Turkish screen-reader labels; order list state kept after actions and only reserved stock restored on cancel; pricing card actions on narrow screens ([#481](https://github.com/aokcuoglu/getirbakim/pull/481), [#487](https://github.com/aokcuoglu/getirbakim/pull/487), [#488](https://github.com/aokcuoglu/getirbakim/pull/488), [#498](https://github.com/aokcuoglu/getirbakim/pull/498), [#527](https://github.com/aokcuoglu/getirbakim/pull/527), [#519](https://github.com/aokcuoglu/getirbakim/pull/519), [#556](https://github.com/aokcuoglu/getirbakim/pull/556)).
- Matching: a new brand is suggested to the new brand its key extends ([#472](https://github.com/aokcuoglu/getirbakim/pull/472)).
- Enrichment: streamed parts2world checkpoint; OE-matched parts2world products keep vehicles and image only ([#421](https://github.com/aokcuoglu/getirbakim/pull/421), [#423](https://github.com/aokcuoglu/getirbakim/pull/423)).
- Storefront and cutover: bundle products matched by supplier key; warm-up through the listening address; AWS starts with empty transactional tables ([#444](https://github.com/aokcuoglu/getirbakim/pull/444), [#450](https://github.com/aokcuoglu/getirbakim/pull/450), [#458](https://github.com/aokcuoglu/getirbakim/pull/458)).

### Maintenance
- Claude Code agent harness (agents, skills, hooks), Fable planner/reviewer and a strict CI gate before `/ship` merges, deterministic checks once per change; catalog CLI worker test independent of CI speed ([#491](https://github.com/aokcuoglu/getirbakim/pull/491), [#531](https://github.com/aokcuoglu/getirbakim/pull/531), [#533](https://github.com/aokcuoglu/getirbakim/pull/533), [#536](https://github.com/aokcuoglu/getirbakim/pull/536), [#569](https://github.com/aokcuoglu/getirbakim/pull/569)).
- Edge nginx config in the repo with a maintenance mode; cutover runbook and export scripts; workflow docs requiring explicit approval for `main` and manual AWS releases ([#441](https://github.com/aokcuoglu/getirbakim/pull/441), [#445](https://github.com/aokcuoglu/getirbakim/pull/445), [#452](https://github.com/aokcuoglu/getirbakim/pull/452), [#460](https://github.com/aokcuoglu/getirbakim/pull/460), [#464](https://github.com/aokcuoglu/getirbakim/pull/464)).

### Deploy and operations
- `scripts/setup.ts` (`db:setup`, run by the AWS release) applies every `db/*.sql` idempotently, including the new matching functions (`product_split_offer`) and indexes (`product_match_candidates_b_idx`, `product_sources_manual_idx`).
- Supplier sync scheduling on AWS is currently disabled (`SUPPLIER_SCHEDULER=manual`); after the release refresh suppliers manually (one group at a time), then the matching refresh runs with it.
- Pending data decisions kept locally (KORJAP approval, KORJAP↔WAGENBURG equivalents) are to be recreated in production after the release.
- The supplier egress proxy (`SUPPLIER_EGRESS_PROXY`) must be set in AWS Secrets Manager for the Dinamik API.

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
