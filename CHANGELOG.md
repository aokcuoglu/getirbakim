# Changelog

All notable changes to this project are documented here. Versions follow [SemVer](https://semver.org/); see `docs/development-workflow.md`.

## v0.43.0 — 2026-11-28

Release of `dev` since v0.42.1 (19 pull requests). This release brings:
- no-fee installments in the storefront and the contract texts;
- the fix for app tasks hitting the V8 heap cap every 1–4 h;
- the app image on Node 24 with capped malloc arenas;
- faster deep, stock-filtered and search listings.

It does not deploy; AWS production is released separately through `release-aws.yml`.

### Added
- **Installments without a fee ("vade farksız"):**
  - An installment option with no fee reads "vade farksız" on the product page, in checkout, on the order page, in the admin order list and in the agreement. No "Vade farkı ₺0,00" row is shown.
  - The admin rate input accepts exactly 0 (vade farksız) or a rate at or above the single-payment rate. A warning appears while an offered installment still carries a fee.
  - No installment-count mismatch note is raised when both the chosen and the paid count are fee-free.
  - The admin order shows the installment count TAMI reports.
  - The distance-sale contract (§5) and the pre-sale information form (§4) gain "Taksit." and "İade." paragraphs. Agreement template v5 and legal version `2026-11-27.…` apply; new orders record the new version.
  - TAMI's hosted page offers 2 and 3 installments, and the merchant pays the commission ([#1463](https://github.com/aokcuoglu/getirbakim/pull/1463), [#1462](https://github.com/aokcuoglu/getirbakim/issues/1462); supersedes #871 and #893).

### Fixed
- **App tasks hitting the V8 heap cap:**
  - The cause: on Node 22, every cached Promise (`staleCache`, `ttlCache`, `sharedLoads`) kept the AsyncLocalStorage context of the request that created it alive, including React's per-request `cache()` results. Settled cache entries now hold plain values.
  - Weights are approximate bytes with a cap per cache, under a process-wide LRU budget `STALE_CACHE_MAX_MB` (default 256, `0` off).
  - In a local crawl with Node 22 behaviour, `heapUsed` went from 694–886 MB to 170–285 MB per round, at the same hit rate of about 70–75 %.
  - Every in-process cache is named. The `Memory:` line now ends `caches=<entries>/<MB>MB hit=…% evicted=… top=<name>:<entries>:<MB>MB,… topEntries=…`, so prod logs show which cache grows ([#1465](https://github.com/aokcuoglu/getirbakim/pull/1465), [#1461](https://github.com/aokcuoglu/getirbakim/issues/1461)).
- **Admin image preview:** the product page previews the automatic image of an unlisted supplier row ([#1445](https://github.com/aokcuoglu/getirbakim/pull/1445), [#1442](https://github.com/aokcuoglu/getirbakim/issues/1442)).

### Changed
- **Node 24 app image:**
  - Both image stages run `node:24-bookworm-slim`, whose AsyncLocalStorage is AsyncContextFrame-based. The app stage sets `MALLOC_ARENA_MAX=2`. CI tests on Node 24.
  - Docker crawl, 2 GB / 1 vCPU: heap about 35 % lower than on Node 22, and native memory about 400 → 220 MB with the arena cap ([#1464](https://github.com/aokcuoglu/getirbakim/pull/1464), [#1278](https://github.com/aokcuoglu/getirbakim/issues/1278)).
- **Deep and stock-filtered listings:**
  - Price orders of large and stock-filtered listings are stored (`storefront_listing_price_orders.filtered`). A filtered deep page races the stored order for 250 ms before reading live. `LISTING_PRICE_ORDER_FILTERED=0` rolls this back ([#1432](https://github.com/aokcuoglu/getirbakim/pull/1432), [#1390](https://github.com/aokcuoglu/getirbakim/issues/1390)).
  - `commerce_catalog` is split into `commerce_supplier_catalog` and a `WITH`-free `commerce_catalog`, so price orders skip the columns they don't use ([#1437](https://github.com/aokcuoglu/getirbakim/pull/1437), [#1424](https://github.com/aokcuoglu/getirbakim/issues/1424)).
  - Live deep price pages order on the lean columns first, then read the cards by id ([#1449](https://github.com/aokcuoglu/getirbakim/pull/1449), [#1430](https://github.com/aokcuoglu/getirbakim/issues/1430)).
  - A scoped listing reads stock for its own ids instead of the whole stock set (`LISTING_STOCK_SCOPE_MAX_IDS`, `0` rolls back) ([#1454](https://github.com/aokcuoglu/getirbakim/pull/1454), [#1429](https://github.com/aokcuoglu/getirbakim/issues/1429)).
  - Brand, manufacturer and make-only listings get the same scoped stock filter ([#1460](https://github.com/aokcuoglu/getirbakim/pull/1460), [#1455](https://github.com/aokcuoglu/getirbakim/issues/1455)).
  - Stock-filtered counts, first-page ids and search orders are served at most `LISTING_STOCK_MAX_SERVE_MS` old (default 60 min, `0` off). Stored deep price orders are exempt ([#1458](https://github.com/aokcuoglu/getirbakim/pull/1458), [#1453](https://github.com/aokcuoglu/getirbakim/issues/1453)).
- **Search:**
  - The order of a price-sorted search is cached per process as packed ids: 16 B per id, at most `SEARCH_PRICE_ORDER_MAX_IDS` (1M, about 16 MB). `SEARCH_PRICE_ORDER=0` rolls back ([#1446](https://github.com/aokcuoglu/getirbakim/pull/1446), [#1425](https://github.com/aokcuoglu/getirbakim/issues/1425)).
  - The same cache holds the ranked order of relevance-sorted filtered searches and newest searches ([#1451](https://github.com/aokcuoglu/getirbakim/pull/1451), [#1440](https://github.com/aokcuoglu/getirbakim/issues/1440)). It also serves plain relevance pages past page 20 ([#1459](https://github.com/aokcuoglu/getirbakim/pull/1459), [#1447](https://github.com/aokcuoglu/getirbakim/issues/1447)). `SEARCH_RANK_ORDER=0` rolls back both.
  - The facets of searches scoped by category, make, model or garage vehicle are cached; `SEARCH_FACETS_CACHE=0` rolls back ([#1457](https://github.com/aokcuoglu/getirbakim/pull/1457), [#1441](https://github.com/aokcuoglu/getirbakim/issues/1441)).
  - `vehicleFitCount` reads the cached search order's total ([#1456](https://github.com/aokcuoglu/getirbakim/pull/1456), [#1450](https://github.com/aokcuoglu/getirbakim/issues/1450)).
  - A vehicle reading's fits come from the search hits. Broad readings such as "dizel", "benzin" or "tdi" are read last. `VEHICLE_SEARCH_MAX_DEFERRED_HITS` (25000, `0` off) is the guard ([#1436](https://github.com/aokcuoglu/getirbakim/pull/1436), [#1407](https://github.com/aokcuoglu/getirbakim/issues/1407)).
  - A test guards rank parity between `summarizeSearch` and `catalogRank` ([#1452](https://github.com/aokcuoglu/getirbakim/pull/1452), [#1448](https://github.com/aokcuoglu/getirbakim/issues/1448)).
- **Agent harness:** the `/ship` skill is now `/deliver`, and Opus is an escalation for the developer agent ([#1444](https://github.com/aokcuoglu/getirbakim/pull/1444), [#1439](https://github.com/aokcuoglu/getirbakim/pull/1439)).

### Deploy and operations
- **`db:setup` (runs in `release-aws`):**
  - It adds `storefront_listing_price_orders.filtered` (lock about 0.1 s locally).
  - It replaces the `commerce_catalog`, `commerce_supplier_catalog` and `storefront_catalog` views. The first setup holds ACCESS EXCLUSIVE on them for about 1.6 s locally; catalog reads wait for that long.
  - Check the "Schema transaction … slowest" line in the release log. If it goes past a few seconds, move the view swap into its own short transaction.
- **App image:** Node 24 with `MALLOC_ARENA_MAX=2`.
- **App task:** it stays at 4 GB with `--max-old-space-size=2560` (getirbakim-infra #36, deployed 2026-11-27). Revisit 2 GB after a few days of `Memory:` lines.
- **New optional env vars:** `SEARCH_PRICE_ORDER`, `SEARCH_RANK_ORDER`, `SEARCH_FACETS_CACHE`, `LISTING_STOCK_MAX_SERVE_MS`, `STALE_CACHE_MAX_MB`. `0` rolls the matching change back.
- **Log query change:** the `caches=` token on the `Memory:` line changed from `<entries>/<ids>` to `<entries>/<MB>MB`. Update any saved Logs Insights query that parses it.
- **After release:**
  - In `/getirbakim-production/app`: `heap out of memory` lines per day should be 0, and `heapUsed` on the `Memory:` lines should plateau. Read `top=` and `topEntries=` to see which cache grows.
  - `boundedQuery slow:` and `boundedQuery timeout:` counts for `catalog.searchOrder` and the listing loads.
  - `/mesafeli-satis-sozlesmesi` and `/on-bilgilendirme-formu` show the new "Taksit." and "İade." paragraphs.
- **Owner, after release:** on `/yonetim/fiyatlandirma`, turn installments on, set max 3, and set the 2- and 3-installment rates to 0. The stored default rates are fee rates, so the warning stays until those are 0.
- **Vehicle oil specs:** unchanged.

## v0.42.1 — 2026-11-26

Patch release of `dev` since v0.42.0 (3 pull requests). **v0.42.0 was never deployed:** its `release-aws` run was cancelled during the pre-release snapshot, before anything changed. Production mail had moved back from Resend to Amazon SES the same day, and v0.42.0 names Resend in the legal texts. This release names Amazon SES again and adds two upload and search hardening fixes. The v0.42.0 deploy and operations steps below apply to this release. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Fixed
- **Legal texts name Amazon SES again:** production mail goes through Amazon SES (`MAIL_TRANSPORT=ses`, SES production access granted on 2026-11-26, getirbakim-infra #33/#35). The KVKK notice and the privacy policy are byte-identical to the owner-approved 2026-11-22 text that production already shows, so the notice version new signups record does not change. This reverts #1361 ([#1427](https://github.com/aokcuoglu/getirbakim/pull/1427), [#1426](https://github.com/aokcuoglu/getirbakim/issues/1426)).

### Changed
- **Verified uploads without a read-back:** the storefront importer and `storeProductImageBytes` send `ChecksumSHA256` from the expected sha256, so S3 checks the bytes itself; the full `GetObject` read-back is gone. A mismatch stores nothing. A store that does not echo the checksum falls back to the read-back and counts it as `mediaReadBack` in the import report. A cold 4,000-object media phase went from 33.7 s to 24.6 s in the local measurement ([#1422](https://github.com/aokcuoglu/getirbakim/pull/1422), [#1417](https://github.com/aokcuoglu/getirbakim/issues/1417)).
- **Bounded spell-correction and synonym loads:**
  - The search spell-correction and the admin synonym load run under a server-side limit (at most 5 s). A failed correction searches as typed.
  - A timeout pauses correction for `SEARCH_FAILURE_HOLD_MS` (default 30 s, `0` off).
  - A type-ahead hit set that timed out is held for 30 s. A key that never loaded answers `503` with `Retry-After: 30`, and the search box then shows no dropdown ([#1428](https://github.com/aokcuoglu/getirbakim/pull/1428), [#1416](https://github.com/aokcuoglu/getirbakim/issues/1416)).

### Deploy and operations
- **All v0.42.0 steps apply:**
  - the `db:setup` tables and columns;
  - getirbakim-infra#27 right after the release;
  - the importer first-sync checks;
  - the post-release log, timing and derive steps.

  The pre-release check of catalog read durations for the 55 s limit was done on 2026-11-26 (#1420). The v0.42.0 check of `/kvkk-aydinlatma-metni` and `/gizlilik-politikasi` is replaced: they show the 2026-11-22 Amazon SES text with no Resend mention.
- **The App stack comes from getirbakim-infra `main`,** which carries the SES configuration-set permission (#35). A CDK deploy from an older infra checkout would remove it and break sending.
- **After release:**
  - no `AccessDenied` or `ses:SendRawEmail` lines in `/getirbakim-production/app`;
  - after the first storefront import, `mediaReadBack` is 0 in `report.json` (#1417);
  - review the `boundedQuery timeout` counts for `catalog.searchHits` and `search.correct` (#1416).
- No schema change beyond v0.42.0. Vehicle oil specs are unchanged.

## v0.42.0 — 2026-11-26

Release of `dev` since v0.41.0 (30 pull requests): the KVKK notice and privacy policy name Resend as the e-mail processor, the header Katalog button opens the category sheet on desktop, the anonymous home page can be edge-cached, deep price-sorted and manufacturer listings are faster, every catalog read gets a server-side time limit, partner search timeouts are answered with 503, the description fitment derive keeps the rows of enriched items, and the nightly storefront sync is lighter. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Added
- **Category sheet from the Katalog button on desktop:** the header Katalog button opens the left category sheet at every width; from 769 px it used to open the mega menu. The category strip keeps the mega menu from 769 px. The sheet preloads on hover or focus of the Katalog button, so a desktop visitor who only uses the strip still never downloads it ([#1374](https://github.com/aokcuoglu/getirbakim/pull/1374), [#1371](https://github.com/aokcuoglu/getirbakim/issues/1371)).

### Fixed
- **Legal texts:**
  - The KVKK notice and the privacy policy name Resend (Plus Five Five, Inc., USA) as the processor of transactional e-mails, with a US transfer paragraph. `updatedAt` is 2026-11-25, so new signups record the new notice version ([#1361](https://github.com/aokcuoglu/getirbakim/pull/1361), [#1360](https://github.com/aokcuoglu/getirbakim/issues/1360), [#1364](https://github.com/aokcuoglu/getirbakim/issues/1364)).
  - The cookie policy lists `gb_garage` and `gb_order_link`. CI now fails when a `gb_*` cookie in the code is missing from the policy ([#1355](https://github.com/aokcuoglu/getirbakim/pull/1355), [#1353](https://github.com/aokcuoglu/getirbakim/issues/1353)).
- **Partner search timeouts:** every production partner timeout was `fittedProductIds` called from the vehicle search. Models whose every type matched are now read from `storefront_model_fits`, only partly matched types are read live, and `fittedProductIds` no longer spills to temp. A search that still times out answers `503 SEARCH_UNAVAILABLE` with `Retry-After` ([#1411](https://github.com/aokcuoglu/getirbakim/pull/1411), [#1395](https://github.com/aokcuoglu/getirbakim/issues/1395)).
- **One database pool per process:** `next start` loads `src/lib/db.ts` twice, so production ran two pools per process and `DATABASE_POOL_MAX` was not the real ceiling ([#1376](https://github.com/aokcuoglu/getirbakim/pull/1376), [#1362](https://github.com/aokcuoglu/getirbakim/issues/1362)).
- **Description fitment derive keeps enriched items' rows:** the first production dry run would have deleted 366,114 of 1,372,559 rows, most of them rows of enriched Dinamik items that make and model pages still list. The derive now neither deletes nor updates the rows of Dinamik items with a usable enrichment and prints a `kept` count. Locally: 16,392 deleted (1.2 %), 350,094 kept ([#1378](https://github.com/aokcuoglu/getirbakim/pull/1378), [#1370](https://github.com/aokcuoglu/getirbakim/issues/1370)).
- **Storefront bundle:**
  - Job statuses travel in job parts capped at 64 MiB, so no manifest grows with enrichments. The base manifest was ~115 MB and would have passed V8's string limit ([#1356](https://github.com/aokcuoglu/getirbakim/pull/1356), [#1317](https://github.com/aokcuoglu/getirbakim/issues/1317)).
  - The importer rewrites a job's `oem` when it changes; the AWS admin showed such products as pending ([#1399](https://github.com/aokcuoglu/getirbakim/pull/1399), [#1386](https://github.com/aokcuoglu/getirbakim/issues/1386)).

### Changed
- **Edge-cacheable home page:** a bare, cookie-less `GET`/`HEAD /` answers `public, max-age=0, s-maxage=60` and renders without the cookie header or client-sent CSP headers. Any cookie, query string, RSC or prefetch request keeps `private, no-store`. CloudFront caches it once getirbakim-infra#27 is deployed ([#1354](https://github.com/aokcuoglu/getirbakim/pull/1354), [#1349](https://github.com/aokcuoglu/getirbakim/issues/1349)).
- **Faster listings:**
  - After a listing epoch change, callers wait at most `LISTING_EPOCH_WAIT_MS` (250 ms) and then get the earlier value while it reloads. The warm-up also warms the ~55 largest manufacturer pages; `/marka/orijinal` took 2.4 s cold in production ([#1363](https://github.com/aokcuoglu/getirbakim/pull/1363), [#771](https://github.com/aokcuoglu/getirbakim/issues/771)).
  - A listing's count, page-1 ids and brand and attribute facets come from one scan instead of four statements; `LISTING_ONE_SCAN=0` is the rollback ([#1382](https://github.com/aokcuoglu/getirbakim/pull/1382), [#1367](https://github.com/aokcuoglu/getirbakim/issues/1367)).
  - Price-sorted pages past page 20 slice a stored whole price order (new UNLOGGED `storefront_listing_price_orders`) and read cards live, so price and stock stay current. `/marka/orijinal?sort=price-asc&page=57` took 5–6 s on every request ([#1388](https://github.com/aokcuoglu/getirbakim/pull/1388), [#1369](https://github.com/aokcuoglu/getirbakim/issues/1369)). Pages 1–20 take their ids from the same order ([#1409](https://github.com/aokcuoglu/getirbakim/pull/1409), [#1389](https://github.com/aokcuoglu/getirbakim/issues/1389)), and a listing with hot first and deep pages is priced once per refresh ([#1415](https://github.com/aokcuoglu/getirbakim/pull/1415), [#1405](https://github.com/aokcuoglu/getirbakim/issues/1405)).
  - The fit sync moves its own `fits_epoch`, so manufacturer, category and plain listings no longer reload on every fit-sync bump ([#1393](https://github.com/aokcuoglu/getirbakim/pull/1393), [#1368](https://github.com/aokcuoglu/getirbakim/issues/1368)).
  - A make's model list and make/model category counts persist in `storefront_listing_cache` (a new task adopts a row up to 1 h old and falls back to one up to 6 h old). A cold task had failed a make page in production ([#1401](https://github.com/aokcuoglu/getirbakim/pull/1401), [#1391](https://github.com/aokcuoglu/getirbakim/issues/1391)).
- **Time limit on catalog reads:** every catalog listing and search read goes through `boundedQuery` with `LISTING_STATEMENT_TIMEOUT_MS` (empty = 55 s, `0` = off), just under the 60 s of CloudFront and the ALB ([#1396](https://github.com/aokcuoglu/getirbakim/pull/1396), [#1377](https://github.com/aokcuoglu/getirbakim/issues/1377)).
- **Search:** searches that may name a vehicle get the 250 ms bounded wait after a fit-sync bump, and suggestions get a 10-minute hit cache ([#1403](https://github.com/aokcuoglu/getirbakim/pull/1403), [#1394](https://github.com/aokcuoglu/getirbakim/issues/1394)). An aborted type-ahead cancels its own reads, which have a 5 s limit (`SUGGEST_STATEMENT_TIMEOUT_MS`) ([#1413](https://github.com/aokcuoglu/getirbakim/pull/1413), [#1398](https://github.com/aokcuoglu/getirbakim/issues/1398)).
- **Nightly storefront sync:**
  - The export streams job statuses and item keys through server-side cursors; it peaked at 1.45 GB RSS at 203k jobs ([#1375](https://github.com/aokcuoglu/getirbakim/pull/1375), [#1357](https://github.com/aokcuoglu/getirbakim/issues/1357)).
  - Unchanged REPXPERT vehicle data ([#1381](https://github.com/aokcuoglu/getirbakim/pull/1381), [#1359](https://github.com/aokcuoglu/getirbakim/issues/1359)) and category images and logos ([#1404](https://github.com/aokcuoglu/getirbakim/pull/1404), [#1379](https://github.com/aokcuoglu/getirbakim/issues/1379)) are skipped by digest. A full send still happens weekly, with `--full`, and after an importer change.
  - The importer stores bundle media before the import transaction and skips objects whose size and sha256 metadata already match (`STOREFRONT_MEDIA_CONCURRENCY`, default 8). At 25 ms S3 latency the transaction went from 224 s to 0.2 s ([#1414](https://github.com/aokcuoglu/getirbakim/pull/1414), [#1406](https://github.com/aokcuoglu/getirbakim/issues/1406)).
  - The import report carries `importerVersion` (the image tag), so only a changed importer forces a full resend ([#1418](https://github.com/aokcuoglu/getirbakim/pull/1418), [#1380](https://github.com/aokcuoglu/getirbakim/issues/1380)).
- Maintenance: end-to-end tests of the storefront bundle export, split and import ([#1387](https://github.com/aokcuoglu/getirbakim/pull/1387), [#1372](https://github.com/aokcuoglu/getirbakim/issues/1372)), the inbound import ([#1400](https://github.com/aokcuoglu/getirbakim/pull/1400), [#1384](https://github.com/aokcuoglu/getirbakim/issues/1384)) and the media remap and static digest skip ([#1410](https://github.com/aokcuoglu/getirbakim/pull/1410), [#1385](https://github.com/aokcuoglu/getirbakim/issues/1385), [#1402](https://github.com/aokcuoglu/getirbakim/issues/1402)); a golden-file test of the part manifest format, checked against the real export ([#1373](https://github.com/aokcuoglu/getirbakim/pull/1373), [#1358](https://github.com/aokcuoglu/getirbakim/issues/1358), [#1412](https://github.com/aokcuoglu/getirbakim/pull/1412), [#1383](https://github.com/aokcuoglu/getirbakim/issues/1383)); the search vehicle scoping test checks the fitted set ([#1419](https://github.com/aokcuoglu/getirbakim/pull/1419), [#1408](https://github.com/aokcuoglu/getirbakim/issues/1408)).

### Deploy and operations
- **Before `release-aws`:** check production durations of the catalog read shapes against the new 55 s limit (#1377). The RDS postgres log keeps every statement over 2 s; a background cache load that needs more than 55 s would never refresh under the limit.
- **`db:setup`** creates the UNLOGGED `storefront_listing_price_orders` with `last_sliced_at` (#1369, #1405) and adds `storefront_listing_epoch.fits_epoch` (#1368). Both columns are added only when missing, so re-runs take no lock. On the first run, read the setup log's `ACCESS EXCLUSIVE on … to COMMIT: N s` lines.
- **Right after the release, getirbakim-infra#27** (CloudFront `/` behaviour; owner approval). Until it is deployed, back/forward can show the visitor's own earlier anonymous copy of the home page; nothing leaks between visitors (#1349).
- **Importer changes** (#1406, #1380) reach the operations image only through `release-aws`. The first sync after it re-sends the vehicle data and static media once; check the task log for `APPLIED … { mediaMs, transactionMs }` and the report's `mediaVerified` / `mediaUploaded`.
- **After release:**
  - `/kvkk-aydinlatma-metni` and `/gizlilik-politikasi` show Resend and the "Yurt Dışına Aktarım" paragraph (#1364).
  - Logs: new `boundedQuery slow:` lines or repeated `boundedQuery timeout: catalog.*` for the same key (#1377); `[partner/v1/products]` timeouts and `boundedQuery timeout: catalog.fittedProductIds` (#1395); `boundedQuery timeout: … (limit 5000 ms` and `boundedQuery cancelled:` for the type-ahead (#1398).
  - Time `/marka/orijinal?sort=price-asc&page=57` and the first `/katalog?sort=price-asc&page=21` order build. If the build falls back after 30 s, set `LISTING_PRICE_ORDER_MAX_IDS` below ~800,000 (#1369). Cold `/marka/orijinal`, `/marka/bosch` and `/marka/bsg` should answer in under 1 s (#771).
  - Description fitment derive: a dry run (deletes well under 10 %, `kept` around 350k), then one real run without `--allow-shrink`, then getirbakim-infra#11. Each step needs owner approval (#1370).
- Vehicle oil specs are unchanged.

## v0.41.0 — 2026-11-24

Release of `dev` since v0.40.0 (26 pull requests): cookieless first-party analytics with self-hosted Plausible, a Report-Only nonce CSP to measure before enforcing, a guarded description fitment derive for an AWS operations task, lighter product and home pages, faster price-sorted and property-filtered listings and searches, and listing, SEO and accessibility fixes. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Added
- **Cookieless analytics (Plausible CE):** every visitor except admins gets a first-party tracker at `/stats/js/script.js` that sends events to `/stats/api/event`. Both routes proxy to the self-hosted Plausible on AWS (`PLAUSIBLE_URL`, getirbakim-infra #21/#24). The tracker sets no cookie and does not depend on consent (KVKK Çerez Rehberi, criterion B). Events have the client IP resolved, keys whitelisted and customer-area ids redacted, and `/yonetim` and token links are dropped. GA4, Ads and Meta stay consent-gated. The cookie policy, KVKK notice and privacy texts describe it ([#1297](https://github.com/aokcuoglu/getirbakim/pull/1297), [#1290](https://github.com/aokcuoglu/getirbakim/issues/1290)).
- **Report-Only nonce CSP:** document responses carry a per-request nonce `script-src` with `'strict-dynamic'` (plus connect, img, frame and form-action sources for the consented tags and TAMI) as `Content-Security-Policy-Report-Only`, reported to `/api/csp-report`. The enforced phase-1 policy is unchanged, and `CSP_REPORT_ONLY=off` switches it off at runtime ([#1311](https://github.com/aokcuoglu/getirbakim/pull/1311), [#1291](https://github.com/aokcuoglu/getirbakim/issues/1291)). The Plausible tag carries the nonce ([#1297](https://github.com/aokcuoglu/getirbakim/pull/1297)).
- **Description fitment derive as an operations task:** `npm run fitment:descriptions derive` runs in its own transaction with lock and statement timeouts and prints one JSON line. Exit codes are 0 ok, 1 error, 2 refused and 3 busy. It refuses an empty catalog, a result under 70 % of the stored rows, or a run that would delete more than 10 % of them unless `--allow-shrink` is given ([#1203](https://github.com/aokcuoglu/getirbakim/pull/1203), [#562](https://github.com/aokcuoglu/getirbakim/issues/562)).

### Fixed
- **"Stokta yok" filter:** a card that is in stock through a grouped offer no longer also appears under "Stokta yok" (25,018 such cards locally) ([#1347](https://github.com/aokcuoglu/getirbakim/pull/1347), [#1342](https://github.com/aokcuoglu/getirbakim/issues/1342), [#1336](https://github.com/aokcuoglu/getirbakim/issues/1336)).
- **`?page=1` listings** are served as the plain, indexable first page. `CollectionPage` JSON-LD now appears only on indexable listings ([#1323](https://github.com/aokcuoglu/getirbakim/pull/1323), [#1250](https://github.com/aokcuoglu/getirbakim/issues/1250), [#1241](https://github.com/aokcuoglu/getirbakim/issues/1241)).
- **Home cards:** no empty or text-less image links, whether the card has no image or its image is off-page ([#1314](https://github.com/aokcuoglu/getirbakim/pull/1314), [#1312](https://github.com/aokcuoglu/getirbakim/issues/1312), [#1315](https://github.com/aokcuoglu/getirbakim/pull/1315), [#1313](https://github.com/aokcuoglu/getirbakim/issues/1313)). Category and title links have 24 px targets, and the robot banner has a visible-text name ([#1329](https://github.com/aokcuoglu/getirbakim/pull/1329), [#1327](https://github.com/aokcuoglu/getirbakim/issues/1327)).
- **Storefront sync:** the bundle export streams enrichments as NDJSON instead of one string past V8's limit; the nightly sync failed on 2026-11-23 ([#1319](https://github.com/aokcuoglu/getirbakim/pull/1319), [#1316](https://github.com/aokcuoglu/getirbakim/issues/1316)). A part upload is retried after a failed `aws s3 sync` ([#1328](https://github.com/aokcuoglu/getirbakim/pull/1328), [#1326](https://github.com/aokcuoglu/getirbakim/issues/1326)). The importer serialises each part's enrichments once ([#1332](https://github.com/aokcuoglu/getirbakim/pull/1332), [#1318](https://github.com/aokcuoglu/getirbakim/issues/1318)).

### Changed
- **Lighter product pages:** "Uyumlu araçlar" prints 6 fitment groups instead of 20 and loads the rest on request, and the OEM/equivalent list loads from `/api/product-references/<id>` ([#1330](https://github.com/aokcuoglu/getirbakim/pull/1330), [#1211](https://github.com/aokcuoglu/getirbakim/issues/1211)). Heavy pages ship only group headers and load engine rows when a group opens. All six #1211 samples are now ≤ 150 KB of HTML ([#1340](https://github.com/aokcuoglu/getirbakim/pull/1340), [#1324](https://github.com/aokcuoglu/getirbakim/issues/1324)).
- **Lighter home page:** HTML 268.5 → 228.5 KB on a local build. Static sections render as client views, the category tabs use named classes, and only the first tab's children ship with the page ([#1325](https://github.com/aokcuoglu/getirbakim/pull/1325), [#1295](https://github.com/aokcuoglu/getirbakim/issues/1295)). Featured cards, the robot banner and the cart link prefetch only on intent ([#1302](https://github.com/aokcuoglu/getirbakim/pull/1302), [#1283](https://github.com/aokcuoglu/getirbakim/issues/1283)). Server components pass icon names to `StoreIcon` instead of lucide definitions ([#1334](https://github.com/aokcuoglu/getirbakim/pull/1334), [#1213](https://github.com/aokcuoglu/getirbakim/issues/1213), [#1344](https://github.com/aokcuoglu/getirbakim/pull/1344), [#1333](https://github.com/aokcuoglu/getirbakim/issues/1333)). Unused utilities are dropped from the storefront stylesheet ([#1339](https://github.com/aokcuoglu/getirbakim/pull/1339)).
- **Faster listings and search:**
  - The property filter reads `storefront_facet_specs`; cold `/katalog` Front Axle went from 2.1–2.5 s to under 0.1 s, and a price-sorted case from a 30 s timeout to 0.16 s ([#1338](https://github.com/aokcuoglu/getirbakim/pull/1338), [#1248](https://github.com/aokcuoglu/getirbakim/issues/1248)).
  - Price-sorted listings with several filters are priced by id array (3.3–4.0 s → ~0.7 s) ([#1346](https://github.com/aokcuoglu/getirbakim/pull/1346), [#1335](https://github.com/aokcuoglu/getirbakim/issues/1335)).
  - Price-sorted searches with filters read their ids once (e.g. 3.34 → 1.05 s) ([#1348](https://github.com/aokcuoglu/getirbakim/pull/1348), [#1345](https://github.com/aokcuoglu/getirbakim/issues/1345)).
  - The model × category sitemap no longer sorts 7.6M rows ([#1337](https://github.com/aokcuoglu/getirbakim/pull/1337), [#1320](https://github.com/aokcuoglu/getirbakim/issues/1320)).
- **Catalog availability rule defined once** as inlined SQL functions (`commerce_source_fresh`, `commerce_supplier_in_stock`, `commerce_supplier_available`, `commerce_supplier_stock_label`, `commerce_store_stock_label`) used by the commerce views, equal to the previous expressions ([#1341](https://github.com/aokcuoglu/getirbakim/pull/1341), [#1249](https://github.com/aokcuoglu/getirbakim/issues/1249)).
- Maintenance: `boundedQuery` timeouts log a query label ([#1322](https://github.com/aokcuoglu/getirbakim/pull/1322), [#1245](https://github.com/aokcuoglu/getirbakim/issues/1245)). Fixes for the listing-cache test isolation ([#1331](https://github.com/aokcuoglu/getirbakim/pull/1331), [#1321](https://github.com/aokcuoglu/getirbakim/issues/1321)) and `verify-catalog-filters` ([#1343](https://github.com/aokcuoglu/getirbakim/pull/1343)).

### Deploy and operations
- **`db:setup` runs first** (`release-aws`): on the first run it creates the five availability functions and replaces the dependent commerce views once through `setup_lock_dependent_views` (#1341). This is a catalog-only change with no table scan or rewrite. Re-runs are no-ops.
- **Plausible is already live** (getirbakim-infra #24/#26, deployed 2026-11-23/24: `stats.getirbakim.com`, site `getirbakim.com`). The app task already has `PLAUSIBLE_URL`, and the repository variables keep it on release. **After release:** a visit to getirbakim.com shows up on the Plausible dashboard, `/stats/js/script.js` answers 200, `/stats/api/event` answers 202, and neither sets a cookie.
- **CSP Report-Only** is on by default. After release, watch the `csp-report` log lines for 7 days (query in `docs/integrations.md`) and make one TAMI 3-D Secure payment; `CSP_REPORT_ONLY=off` plus a restart turns it off.
- **Product references API:** CloudFront has no cache behaviour yet for `/api/product-references/*` (getirbakim-infra #25, needs owner approval). Until then the route works uncached through the default behaviour.
- **Description fitment derive:** the schedule (getirbakim-infra #11, `PRODUCTION_DESCRIPTION_FITMENTS_ENABLED`, off by default) stays off. The first run follows the #1203 procedure: a dry run (expected to be refused by the delete guard), review the diff, run once with `--allow-shrink` off-peak, then enable it. Each step needs owner approval.
- **After release:** re-run the SEO audit and `npm run harness:measure -- --base https://getirbakim.com` for live home and product page sizes, and measure cold TTFB of property-filtered and price-sorted listings. Vehicle oil specs are unchanged.

## v0.40.0 — 2026-11-22

Release of `dev` since v0.39.0 (18 pull requests): individual customer accounts with e-mail verification and password reset (off in production until account e-mail is enabled), customer → service account applications, a Content-Security-Policy header, curated descriptions for 30 categories, a lighter home page (fewer requests, less HTML and CSS), bounded app memory and fast deep out-of-stock pages. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Added
- **Individual customer accounts:** a new `customer` role signs up from the register modal (name, e-mail, password, terms acceptance, honeypot, IP/e-mail/global rate limits), sees list prices and cannot reach `/yonetim`; the B2B service application stays separate ([#1268](https://github.com/aokcuoglu/getirbakim/pull/1268), [#1254](https://github.com/aokcuoglu/getirbakim/issues/1254)). Signup terms acceptance is recorded in `account_term_acceptances` and the legal pages describe individual membership ([#1276](https://github.com/aokcuoglu/getirbakim/pull/1276), [#1256](https://github.com/aokcuoglu/getirbakim/issues/1256)).
- **E-mail verification before a customer account opens:** signup always answers "E-postanı kontrol et", the 24 h single-use link verifies and logs in (same browser) or forces a password reset (other browser); unverified accounts cannot log in and are pruned after 7 days without orders ([#1284](https://github.com/aokcuoglu/getirbakim/pull/1284), [#1258](https://github.com/aokcuoglu/getirbakim/issues/1258)).
- **Password reset by e-mail** for customers and approved service accounts (`/sifre-yenile`): identical answer for every address, 60 min single-use hashed token, all sessions ended on reset ([#1281](https://github.com/aokcuoglu/getirbakim/pull/1281), [#1257](https://github.com/aokcuoglu/getirbakim/issues/1257)).
- **Customer → service account application** from `/servisler/basvuru`; admins approve or reject on the `/yonetim` pending card, approval turns the same account into a service account with the chosen discount ([#1277](https://github.com/aokcuoglu/getirbakim/pull/1277), [#1259](https://github.com/aokcuoglu/getirbakim/issues/1259)).
- **Content-Security-Policy** on every response: `object-src 'none'; base-uri 'self'; frame-ancestors 'self'` plus `upgrade-insecure-requests` on https builds; no fetch or form directive yet (phase 2: [#1291](https://github.com/aokcuoglu/getirbakim/issues/1291)) ([#1292](https://github.com/aokcuoglu/getirbakim/pull/1292), [#1287](https://github.com/aokcuoglu/getirbakim/issues/1287)).
- **Account e-mail switch `ACCOUNT_EMAIL`:** in production, customer signup, e-mail verification and password reset are hidden and refused (`/sifre-yenile`, `/e-posta-dogrula` → 404) unless `ACCOUNT_EMAIL=on` and a mail transport are configured; login, the B2B application and the customer → service upgrade are unchanged ([#1306](https://github.com/aokcuoglu/getirbakim/pull/1306), [#1303](https://github.com/aokcuoglu/getirbakim/issues/1303)).
- **Curated part types:** the curated part type list grows from 93 to 195 entries so more Spareto / parts2world enrichments reach a category, the sitemap and price-only cards ([#1305](https://github.com/aokcuoglu/getirbakim/pull/1305), [#1299](https://github.com/aokcuoglu/getirbakim/issues/1299)).
- **Curated descriptions for 30 categories** (top-level part groups and the largest leaves, 100–160 characters) ([#1279](https://github.com/aokcuoglu/getirbakim/pull/1279), [#1223](https://github.com/aokcuoglu/getirbakim/issues/1223)).

### Fixed
- **Deep out-of-stock pages:** `/katalog?availability=out_of_stock` deep pages (93 s, page 49 → 504 on prod) read a sized `commerce_out_of_stock_ids()` set and hash it instead of nested-looping ([#1298](https://github.com/aokcuoglu/getirbakim/pull/1298), [#1286](https://github.com/aokcuoglu/getirbakim/issues/1286)).
- **App memory:** in-process caches are bounded and memory usage is logged; the V8 heap cap itself is getirbakim-infra #17 ([#1272](https://github.com/aokcuoglu/getirbakim/pull/1272), [#1262](https://github.com/aokcuoglu/getirbakim/issues/1262)).
- **Modal login** returns to the current page like signup ([#1274](https://github.com/aokcuoglu/getirbakim/pull/1274), [#1261](https://github.com/aokcuoglu/getirbakim/issues/1261)).

### Changed
- **Lighter home page:** carousels arm on approach and low-intent links no longer prefetch (mobile Lighthouse requests 125 → ~75–81) ([#1280](https://github.com/aokcuoglu/getirbakim/pull/1280), [#1226](https://github.com/aokcuoglu/getirbakim/issues/1226)); fewer cards spread by brand, client make/brand tiles, off-page images deferred, the tax note once per product section and no plain e-mail in the footer or Organization JSON-LD (home HTML 341 → 267 KB) ([#1294](https://github.com/aokcuoglu/getirbakim/pull/1294), [#1289](https://github.com/aokcuoglu/getirbakim/issues/1289)); workspace-only dark variants left out of the storefront stylesheet (251 → 244 KB) ([#1293](https://github.com/aokcuoglu/getirbakim/pull/1293), [#1288](https://github.com/aokcuoglu/getirbakim/issues/1288)).
- Maintenance: expired rate-limit attempt rows are prunable (`scripts/prune-attempt-rows.ts`) ([#1270](https://github.com/aokcuoglu/getirbakim/pull/1270), [#1260](https://github.com/aokcuoglu/getirbakim/issues/1260)); the public hero and mobile catalog image copies kept for the #1217/#1227 rollout are removed ([#1273](https://github.com/aokcuoglu/getirbakim/pull/1273), [#1285](https://github.com/aokcuoglu/getirbakim/pull/1285), [#1231](https://github.com/aokcuoglu/getirbakim/issues/1231)).

### Deploy and operations
- **No SES precondition:** without `ACCOUNT_EMAIL=on` (unset today) customer signup and password reset stay off in production, so the release does not depend on SES. To turn them on after SES production access: add `ACCOUNT_EMAIL=on` to the app environment in getirbakim-infra, then release (`docs/commerce.md` "Hesap e-postaları anahtarı").
- **`db:setup` runs first** (`release-aws`): `account_tokens`, `service_upgrade_requests` (first run takes SHARE ROW EXCLUSIVE on `accounts` once for the FK), `account_term_acceptances`, `accounts.email_verified_at` (metadata-only, `DEFAULT now()` so existing accounts stay verified), the widened `accounts_role_check`, and `commerce_out_of_stock_ids()` (`CREATE OR REPLACE FUNCTION`, no relation lock). Re-runs take no lock.
- **Infra:** schedule the nightly attempt/token/unverified-account prune (getirbakim-infra #18); the heap cap (#17) and keep-alive fix (#15) deploy with the next approved App release.
- **After release:** re-measure cold TTFB of `/katalog?availability=out_of_stock&page=22|49` (#1286); re-run the SEO audit and `npm run harness:measure -- --base https://getirbakim.com` for live home sizes and requests; `curl -sI https://getirbakim.com/` shows `Content-Security-Policy`; one TAMI sandbox 3-D Secure payment. Part type curation (#1305) reaches AWS with the next `release-categories --source all` after the local `backfill-types` runs. Vehicle oil specs are unchanged.

## v0.39.0 — 2026-11-22

Release of `dev` since v0.38.0 (9 pull requests): monthly partner period close and statements, guide notes under top-level category listings, make × category copy and sitemap, lighter listing and home HTML, faster in-stock filters and root category resolution, a noindex root category, and fresher hashed storefront assets. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Added
- **Partner period close and monthly statements:** close or reopen an Istanbul calendar month per partner on `/yonetim/partnerler` (contiguous closes, reopen with a 5–500 character reason, every event audited); closed months refuse invoice marks, corrections, undo and payments dated in them; admin-only statement CSV `/yonetim/partnerler/ekstre?partner=&donem=YYYY-MM` with invoices, payments and opening/closing balance ([#1253](https://github.com/aokcuoglu/getirbakim/pull/1253), [#1200](https://github.com/aokcuoglu/getirbakim/issues/1200)); `/yonetim/siparisler` shows "Dönem kapalı" instead of the single-order invoice undo for orders in a closed month ([#1266](https://github.com/aokcuoglu/getirbakim/pull/1266), [#1265](https://github.com/aokcuoglu/getirbakim/issues/1265)).
- **Make × category sitemap:** `/sitemaps/make-categories.xml` lists the indexable `/kategori/<kategori>/<marka>` pages (10+ products, root excluded), cached and warmed like `model-categories.xml` ([#1255](https://github.com/aokcuoglu/getirbakim/pull/1255), [#1224](https://github.com/aokcuoglu/getirbakim/issues/1224)).
- **Category guide notes:** the six top-level categories show a short "… seçerken nelere bakılır?" note with links to their guide articles on the plain first page only; page 2's "Önceki sayfa" now links to the canonical first page ([#1246](https://github.com/aokcuoglu/getirbakim/pull/1246), [#646](https://github.com/aokcuoglu/getirbakim/issues/646)).

### Fixed
- **Root category timeout:** `/kategori/yedek-parca` no longer hits the 30 s statement timeout; the category × enrichment links are materialised before joining `supplier_items` (55.7 s → 0.56 s locally, same result set) ([#1251](https://github.com/aokcuoglu/getirbakim/pull/1251), [#1240](https://github.com/aokcuoglu/getirbakim/issues/1240)).
- **Root category SEO:** `/kategori/yedek-parca` is `noindex,follow` with a self canonical, dropped from `categories.xml` and `llms.txt`, and has no `CollectionPage` JSON-LD ([#1243](https://github.com/aokcuoglu/getirbakim/pull/1243), [#1222](https://github.com/aokcuoglu/getirbakim/issues/1222)).

### Changed
- **Make × category copy:** grammatical meta description with the product count, a make-level H2 and intro instead of the plain category copy; model × category text unchanged ([#1255](https://github.com/aokcuoglu/getirbakim/pull/1255), [#1224](https://github.com/aokcuoglu/getirbakim/issues/1224)).
- **Lighter listing and home HTML:** product cards, the vehicle model list and home product cards render through small client views fed by precomputed strings, so their markup is no longer sent twice; listings and home now stay within a 400 KB raw HTML budget (e.g. `/yedek-parca/volkswagen` 415 → 318 KB, `/kategori/filtre` 387 → 323 KB, home 385 → 345 KB on a local production build) ([#1247](https://github.com/aokcuoglu/getirbakim/pull/1247), [#1212](https://github.com/aokcuoglu/getirbakim/issues/1212), [#1214](https://github.com/aokcuoglu/getirbakim/issues/1214)).
- **In-stock filter:** `availability=` listings read the new lean `commerce_item_availability` view instead of the full `commerce_catalog` pricing subquery (cold prod listings were 9–14 s) ([#1252](https://github.com/aokcuoglu/getirbakim/pull/1252), [#1242](https://github.com/aokcuoglu/getirbakim/issues/1242)).
- **Storefront asset caching:** fonts, icons, backgrounds, the brand logo and part-art placeholders are served as content-hashed `/_next/static/media` files; the bare `/media` and `/brand` fallback is `max-age=86400, s-maxage=3600, stale-while-revalidate=600`, so it never arrives stale ([#1244](https://github.com/aokcuoglu/getirbakim/pull/1244), [#1227](https://github.com/aokcuoglu/getirbakim/issues/1227)).

### Deploy and operations
- **`db:setup` runs first** (`release-aws`): creates the `commerce_item_availability` view (additive, no lock on existing relations) and `partner_period_closes` / `partner_period_events` (first run takes SHARE ROW EXCLUSIVE on `accounts` once for the foreign keys; no backfill). Re-runs take no lock.
- **Partner webhooks:** `PARTNER_WEBHOOKS_JSON` is now on the AWS app secret (infra #13) and this release starts delivering. Release BakımX first (its v2.3 receiver, bakimx#767); otherwise the first deliveries get 400 and, after 72 h, can be re-sent from `/yonetim/partnerler`.
- **After release:** repeat the cold `availability=in_stock` TTFB check from #1242; EXPLAIN (ANALYZE) the root category id resolution over the read-only prod tunnel (#1240); optionally request removal or re-crawl of `/kategori/yedek-parca` in Search Console; re-run `npm run harness:measure -- --base https://getirbakim.com` for live sizes; before relying on `make-categories.xml`, time its query on RDS with `scripts/sitemap-model-timings.ts --explain` in the operations task. No CloudFront invalidation needed. Vehicle oil specs are unchanged.

## v0.38.0 — 2026-11-22

Release of `dev` since v0.37.0 (26 pull requests): partner collections against invoices, per-order invoice undo, partner return webhooks with requeue and retention, open price anomalies in health and the Başbuğ list, eight guide articles, blocked shared image previews, SEO titles and descriptions within length limits, security headers, a faster homepage hero, a persistent listing cache and catalog read speed-ups. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Added
- **Partner collections:** record payments against partner invoices with a per-partner payment term (0–365 days), due date and status; partial payments allowed, over-payment refused, wrong payments voided with a reason; informational only, the credit limit is unchanged ([#1209](https://github.com/aokcuoglu/getirbakim/pull/1209), [#1006](https://github.com/aokcuoglu/getirbakim/issues/1006)).
- **Partner invoice history and per-order undo** on the `/yonetim/siparisler` order row: the last 5 invoice changes, and "Fatura işaretini geri al" with a mandatory reason, stale check and audit row ([#1195](https://github.com/aokcuoglu/getirbakim/pull/1195), [#1038](https://github.com/aokcuoglu/getirbakim/issues/1038)).
- **Partner return webhooks:** approving or rejecting a partner return request records a `partner.return.updated` event and delivers the Return object as it is at send time; an operations step on an order and an applied Geliver tracking update send that order's webhooks right away instead of on the next 5-minute sweep; partner contract v2.3 ([#1198](https://github.com/aokcuoglu/getirbakim/pull/1198), [#1002](https://github.com/aokcuoglu/getirbakim/issues/1002)).
- **Requeue given-up partner webhooks** from `/yonetim/partnerler` (single and per partner, same `eventId`), a fair queue for requeued events, and 90-day pruning of delivered/skipped/dead rows ([#1229](https://github.com/aokcuoglu/getirbakim/pull/1229), [#1002](https://github.com/aokcuoglu/getirbakim/issues/1002)).
- **Open price anomalies** in `/api/health/suppliers` (informational, never a 503), a `?quality=price-anomaly` filter on the Başbuğ list and a "Fiyat anomalisi" metric on its quality card ([#1206](https://github.com/aokcuoglu/getirbakim/pull/1206), [#1049](https://github.com/aokcuoglu/getirbakim/issues/1049)).
- **Eight guide articles** on `/rehber` for common maintenance and part questions ([#1233](https://github.com/aokcuoglu/getirbakim/pull/1233), [#646](https://github.com/aokcuoglu/getirbakim/issues/646)).
- **Blocked shared image preview** on `/yonetim/ortak-gorseller` through an admin-only, no-store media route; visitors still never get blocked media ([#1193](https://github.com/aokcuoglu/getirbakim/pull/1193), [#1176](https://github.com/aokcuoglu/getirbakim/issues/1176)).
- **Homepage title and description** written for search (59 / 146 characters) and a WebSite `SearchAction` pointing at `/katalog?q=` ([#1220](https://github.com/aokcuoglu/getirbakim/pull/1220), [#1215](https://github.com/aokcuoglu/getirbakim/issues/1215)).

### Fixed
- **Template SEO lengths:** category, product, model, make, search and legal page titles stay within 65 characters and meta descriptions within 160, with padding for short ones; `/rehber` has a descriptive H1 ([#1234](https://github.com/aokcuoglu/getirbakim/pull/1234), [#1218](https://github.com/aokcuoglu/getirbakim/issues/1218)).
- **Security headers and asset caching:** HSTS, `nosniff`, `SAMEORIGIN` and `strict-origin-when-cross-origin` on every response (`no-referrer` kept on payment and guest order link routes); `/media` and `/brand` requested with this build's `?dpl=` are cached for a year, other requests keep the one-day policy ([#1230](https://github.com/aokcuoglu/getirbakim/pull/1230), [#1216](https://github.com/aokcuoglu/getirbakim/issues/1216)).
- **Refused order lines are named** when an order fails on an unpriced, unavailable or over-cap item, with neutral copy ([#1197](https://github.com/aokcuoglu/getirbakim/pull/1197), [#1188](https://github.com/aokcuoglu/getirbakim/issues/1188)).
- **Price anomalies are re-checked** after the order-time Başbuğ refresh ([#1192](https://github.com/aokcuoglu/getirbakim/pull/1192), [#1172](https://github.com/aokcuoglu/getirbakim/issues/1172)).
- **Side safe areas** pad the static chrome and main content in landscape on notched phones ([#1219](https://github.com/aokcuoglu/getirbakim/pull/1219), [#911](https://github.com/aokcuoglu/getirbakim/issues/911)); 44px hit area for header strip triggers and search submit ([#1191](https://github.com/aokcuoglu/getirbakim/pull/1191), [#1181](https://github.com/aokcuoglu/getirbakim/issues/1181)).

### Changed
- **Homepage hero** is served from content-hashed static imports, so a stale CDN copy can no longer slow the LCP image ([#1232](https://github.com/aokcuoglu/getirbakim/pull/1232), [#1217](https://github.com/aokcuoglu/getirbakim/issues/1217)).
- **Persistent listing cache:** listing counts, page ids and facets survive restarts and deploys in the `UNLOGGED` `storefront_listing_cache` (off switch `LISTING_CACHE_PERSIST=0`) ([#1210](https://github.com/aokcuoglu/getirbakim/pull/1210), [#957](https://github.com/aokcuoglu/getirbakim/issues/957)).
- **Precomputed facet specifications** in `storefront_facet_specs` for the cold `/katalog` attribute facet ([#1194](https://github.com/aokcuoglu/getirbakim/pull/1194), [#994](https://github.com/aokcuoglu/getirbakim/issues/994)).
- **Catalog reads:** hot by-id reads as named prepared statements ([#1208](https://github.com/aokcuoglu/getirbakim/pull/1208), [#1170](https://github.com/aokcuoglu/getirbakim/issues/1170)); one SQL function for the latest succeeded import ([#1199](https://github.com/aokcuoglu/getirbakim/pull/1199), [#1169](https://github.com/aokcuoglu/getirbakim/issues/1169)); admin matching and restock prices by id array ([#1190](https://github.com/aokcuoglu/getirbakim/pull/1190), [#1168](https://github.com/aokcuoglu/getirbakim/issues/1168)).
- **Storefront stylesheet** scans only storefront sources; `/yonetim` gets its own utilities sheet ([#1204](https://github.com/aokcuoglu/getirbakim/pull/1204), [#1027](https://github.com/aokcuoglu/getirbakim/issues/1027)); storefront error box on destructive-subtle/strong tokens ([#1196](https://github.com/aokcuoglu/getirbakim/pull/1196), [#1180](https://github.com/aokcuoglu/getirbakim/issues/1180)).
- Tooling and CI: one-command production-build store measurement `npm run harness:measure` ([#1221](https://github.com/aokcuoglu/getirbakim/pull/1221)); two self-hosted runners on the Mac and no npm cache step there ([#1236](https://github.com/aokcuoglu/getirbakim/pull/1236), [#1228](https://github.com/aokcuoglu/getirbakim/pull/1228), [#1202](https://github.com/aokcuoglu/getirbakim/pull/1202)).

### Deploy and operations
- **`db:setup` runs first** (`release-aws`): `storefront_listing_cache` (fills itself; until it exists the app runs memory-only), `storefront_facet_specs` with its refresh function (filled by the closing link sync; afterwards check `SELECT count(*) FROM storefront_facet_specs` is non-zero; every full link rebuild takes ~4 s longer), the latest-import function and view (replaces `commerce_catalog` once with a brief ACCESS EXCLUSIVE), partner collections and payment term (brief SHARE ROW EXCLUSIVE on `accounts`, ACCESS EXCLUSIVE on the small `partner_settings`), `partner_invoice_changes_order_idx`, and the `partner_webhook_return_event` trigger (first run takes SHARE ROW EXCLUSIVE on `partner_return_requests`). Re-runs take no lock.
- **Partner:** send contract v2.3 to BakımX. Webhook delivery still needs `PARTNER_WEBHOOKS_JSON` on the AWS app secret.
- **Before release:** run one TAMI sandbox payment with 3-D Secure to confirm the new `X-Frame-Options: SAMEORIGIN` does not affect the bank step.
- **After release:** re-run PageSpeed on getirbakim.com; check prod `pg_stat_statements` for the prepared by-id reads; no CloudFront invalidation needed (new `?dpl=` values are new cache keys). The `public/` hero copies stay one release (#1231). Vehicle oil specs are unchanged.

## v0.37.0 — 2026-11-21

Release of `dev` since v0.36.0 (9 pull requests): partner order webhooks, admin blocking of wrong shared images, a notice page for expired guest order links, pending partner returns on the manual return form, price-anomaly re-checks after every Başbuğ price sync, faster make pages and catalog reads, and the last storefront controls on the shared button scale. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Added
- **Partner order webhooks:** a trigger on `commerce_orders` records one `partner_webhook_events` row per partner-visible change (status, carrier and tracking, shipped/delivered, cancel and cancel request/rejection) in the same transaction; delivery runs after the 5-minute reconcile sweep, HMAC-SHA256 signed, retried for 72 h; "Webhook bildirimleri" on `/yonetim/partnerler`; partner contract v2.2 ([#1183](https://github.com/aokcuoglu/getirbakim/pull/1183), [#1002](https://github.com/aokcuoglu/getirbakim/issues/1002)). Until `PARTNER_WEBHOOKS_JSON` is set, events are recorded as `skipped`. `/api/partner/v1/*` routes and `partner_settings` are unchanged.
- **Block or unblock a shared automatic image** from `/yonetim/ortak-gorseller` (`product_image_blocks`); the block is applied where the shared links are derived, so every storefront, partner, feed and media path hides it and a storefront sync cannot undo it ([#1182](https://github.com/aokcuoglu/getirbakim/pull/1182), [#1136](https://github.com/aokcuoglu/getirbakim/issues/1136)).
- **Expired or invalid guest order link** now lands on `/siparis/baglanti` with next steps instead of a 404; signature is checked before expiry, so "expired" is only shown for a genuine link ([#1177](https://github.com/aokcuoglu/getirbakim/pull/1177), [#1148](https://github.com/aokcuoglu/getirbakim/issues/1148)).
- **Pending partner return requests** on the admin's manual return form: listed per line, the form caps at ordered − accepted − pending, and each refusal has its own message ([#1171](https://github.com/aokcuoglu/getirbakim/pull/1171), [#1151](https://github.com/aokcuoglu/getirbakim/issues/1151)).

### Fixed
- **Price anomalies are re-checked after every Başbuğ price/stock sync** (scoped to the rows whose price changed in that tick), not only after the nightly full list; unjudged dismissed rows reopen on a 1.5× move or a currency change ([#1175](https://github.com/aokcuoglu/getirbakim/pull/1175), [#1153](https://github.com/aokcuoglu/getirbakim/issues/1153)).

### Changed
- **Make pages** read description fitments from the precomputed `storefront_make_description_fits` instead of scanning `product_model_fitments` (VW 52–63 → 20–29 ms locally); the listed set is unchanged ([#1184](https://github.com/aokcuoglu/getirbakim/pull/1184), [#956](https://github.com/aokcuoglu/getirbakim/issues/956)).
- **Catalog by-id reads** (cart, checkout price check, partner offers, equivalents) use an index-backed latest import and one `id=ANY(…)` statement instead of a per-id LATERAL ([#1185](https://github.com/aokcuoglu/getirbakim/pull/1185), [#1158](https://github.com/aokcuoglu/getirbakim/issues/1158)).
- **Storefront controls:** header category menu, phone category sheet and search dropdown controls on `storeButton` at 44px with token colours ([#1178](https://github.com/aokcuoglu/getirbakim/pull/1178), [#1173](https://github.com/aokcuoglu/getirbakim/issues/1173)); hex → tokens on storefront triggers and the Bakım Robotu kit builder, and a 14px / 44px card specs toggle ([#1179](https://github.com/aokcuoglu/getirbakim/pull/1179), [#1174](https://github.com/aokcuoglu/getirbakim/issues/1174)).

### Deploy and operations
- **`db:setup` runs first** (`release-aws`): new `db/partner.sql` (webhook events table and trigger; first run takes SHARE ROW EXCLUSIVE on `commerce_orders`, `partner_return_requests`, `accounts` until commit), `product_image_blocks` and the shared-links function (brief lock on `accounts`), `storefront_make_description_fits` with triggers and a one-time backfill (17.5 s locally; SHARE ROW EXCLUSIVE on `product_model_fitments` and `product_override_fitment_hides`, which blocks writers only), and the guarded `supplier_imports_latest_success_idx`.
- **Partner webhooks:** add `PARTNER_WEBHOOKS_JSON` to the AWS app secret (infra `ADDED_APP_SECRET_KEYS` + `set-app-secret.sh`) once BakımX provides an https endpoint and a secret; send contract v2.2 to BakımX.
- Shared image blocks are not carried between AWS and local; never run `clearPlaceholderImages` for panel blocks. Vehicle oil specs are unchanged.

## v0.36.0 — 2026-11-21

Release of `dev` since v0.35.0 (21 pull requests): shipped, cancelled and refunded customer emails with a signed guest order link, partner returns and per-partner B2B discounts, new supplier price-anomaly rules with reopening of dismissed decisions, a shared-images admin list, a verified storefront sync upload, smaller logos and storefront performance work. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Added
- **Order status emails:** shipped (carrier, tracking number, http(s)-only tracking link), cancelled (accepted orders only; expiry and unpaid cancels send nothing) and payment refunded (amount only when reliable) on the order email outbox, queued in the same transaction as the state change, one per order and kind, never for partner orders; admin rows, resend and per-kind reasons on `/yonetim/siparisler` ([#1160](https://github.com/aokcuoglu/getirbakim/pull/1160), [#1036](https://github.com/aokcuoglu/getirbakim/issues/1036)).
- **Signed guest order link** so order emails open the order on any device; 90-day token, off until `ORDER_LINK_SIGNING_SECRET` is set ([#1145](https://github.com/aokcuoglu/getirbakim/pull/1145)).
- **Partner returns endpoint** for shipped orders and return decisions in `/yonetim/siparisler`; partner contract v2.1 ([#1150](https://github.com/aokcuoglu/getirbakim/pull/1150)).
- **Per-partner B2B discount** set on `/yonetim/partnerler` instead of `PARTNER_B2B_DISCOUNT_BPS` ([#1138](https://github.com/aokcuoglu/getirbakim/pull/1138)).
- **Price anomalies:** cross-offer outliers (≥10× from other suppliers' offers and explained by a currency the brand genuinely uses) and underpriced rare-currency rows are unpriced until dismissed; a run never deletes an anomaly it could not judge for want of a rate ([#1146](https://github.com/aokcuoglu/getirbakim/pull/1146), [#1050](https://github.com/aokcuoglu/getirbakim/issues/1050)).
- **Ortak görseller** (`/yonetim/ortak-gorseller`): automatic images shared by many part numbers and the products using each, linking to the product's image tab ([#1144](https://github.com/aokcuoglu/getirbakim/pull/1144), [#1097](https://github.com/aokcuoglu/getirbakim/issues/1097)); each image shows whether it is on the placeholder denylist ([#1154](https://github.com/aokcuoglu/getirbakim/pull/1154)).

### Fixed
- **Dismissed price anomalies reopen** when the supplier value reaches 1.5× or 1/1.5 of the decided value or the currency changes; stale admin decisions are ignored ([#1156](https://github.com/aokcuoglu/getirbakim/pull/1156), [#1142](https://github.com/aokcuoglu/getirbakim/issues/1142)).
- **Storefront sync verifies every uploaded part** against its manifest before the AWS import starts; a failed check leaves the watermark in place ([#1140](https://github.com/aokcuoglu/getirbakim/pull/1140), [#1129](https://github.com/aokcuoglu/getirbakim/issues/1129)).
- **Storefront sync run prefixes (opt-in):** `STOREFRONT_SYNC_PREFIX_MODE=run` uploads every run to `storefront/current/run-<snapshotAt>/`, points the import task at it and removes the fixed-layout parts and older runs (keeping the newest previous one) after a successful import, so leftovers of an earlier run can no longer be imported; the default stays the fixed prefix until the infra change letting the sync role read run reports is deployed. `STOREFRONT_SYNC_S3_CONCURRENCY` sets `max_concurrent_requests` for the run's own `aws s3` calls without touching `~/.aws/config`; the dry run prints export/split timings ([#1155](https://github.com/aokcuoglu/getirbakim/pull/1155), [#1137](https://github.com/aokcuoglu/getirbakim/issues/1137)).
- **Enrichment part keys** come from every word suffix of the supplier code, and stale alias brand keys (REINZ, AVACLEVERCHOICE) are rewritten; Trodo search strips the label or master brand prefix ([#1141](https://github.com/aokcuoglu/getirbakim/pull/1141), [#1117](https://github.com/aokcuoglu/getirbakim/issues/1117)).
- **Known placeholder images** are denylisted at display, import and cleanup ([#1147](https://github.com/aokcuoglu/getirbakim/pull/1147)).
- **SQL brand and part keys fold diacritics** like the TypeScript normaliser (LEMFÖRDER → LEMFORDER); changed stored keys are rewritten once ([#1162](https://github.com/aokcuoglu/getirbakim/pull/1162), [#1139](https://github.com/aokcuoglu/getirbakim/issues/1139)).

### Changed
- **Logos re-encoded to 2× display size:** vehicle 1,495 KB → 701 KB, manufacturer 300 KB → 208 KB; new imports are fitted unless that would grow the file; a stale `?v=` on `/api/manufacturer-logos` serves current bytes instead of 404 ([#1159](https://github.com/aokcuoglu/getirbakim/pull/1159), [#1029](https://github.com/aokcuoglu/getirbakim/issues/1029)).
- Storefront performance: per-page shell HTML trimmed ([#1161](https://github.com/aokcuoglu/getirbakim/pull/1161)), listing and home cards read by id array ([#1157](https://github.com/aokcuoglu/getirbakim/pull/1157)), off-page home carousel images deferred ([#1143](https://github.com/aokcuoglu/getirbakim/pull/1143)), named listing markup classes and an HTML budget probe ([#1132](https://github.com/aokcuoglu/getirbakim/pull/1132)); raw storefront buttons moved onto `storeButton` ([#1131](https://github.com/aokcuoglu/getirbakim/pull/1131)).
- Privacy and KVKK texts cover orders, payments and the address book ([#1128](https://github.com/aokcuoglu/getirbakim/pull/1128)).

### Deploy and operations
- **`db:setup` runs first** (`release-aws`). Before the schema transaction, short constraint swaps widen `supplier_price_anomalies.kind` (`offer-outlier`) and `commerce_order_emails.kind` (`shipped`, `cancelled`, `refunded`); without them ship/cancel/refund steps fail. Also: partner return tables and column ([#1150](https://github.com/aokcuoglu/getirbakim/pull/1150), SHARE ROW EXCLUSIVE once on `commerce_orders`, `accounts`, `commerce_order_items`), partner discount column ([#1138](https://github.com/aokcuoglu/getirbakim/pull/1138)), `enrichment_supplier_part_keys()` and the alias backfill ([#1141](https://github.com/aokcuoglu/getirbakim/pull/1141)); diacritic-folding key functions, rewriting only changed `enrichment_search_products` keys ([#1162](https://github.com/aokcuoglu/getirbakim/pull/1162)).
- **Before release:** add `ORDER_LINK_SIGNING_SECRET` to the AWS app task environment (infra), otherwise the signed guest link stays off. Status emails need the mail transport (SES production access still pending).
- **After release:** set BakımX's discount on `/yonetim/partnerler`; tell BakımX that contract v2.1 adds the returns endpoint.
- **Separately approved data steps:** `npm run enrichment:placeholders -- clean --apply` then `storefront:sync` ([#1147](https://github.com/aokcuoglu/getirbakim/pull/1147)); `npm run logos:reencode -- db --apply` then `storefront:sync` ([#1159](https://github.com/aokcuoglu/getirbakim/pull/1159)). Storefront sync run-prefix mode needs getirbakim-infra#9 first.
- The KVKK text says the AWS standard contract is signed and notified; that must actually be done by the owner ([#1128](https://github.com/aokcuoglu/getirbakim/pull/1128)). Vehicle oil specs are unchanged.

## v0.35.0 — 2026-11-21

Release of `dev` since v0.34.0 (3 pull requests): BakımX partner search ranks the parts fitting the work-order vehicle from every match, a per-partner order intake switch and order email state with resend in the admin. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Added
- **Per-partner order intake switch** on `/yonetim/partnerler`: a paused partner's `POST /order-quotes` and `POST /orders` answer `503 ORDER_INTAKE_PAUSED`; reads, cancels and idempotent replays keep working; checked again under the partner's order lock ([#1113](https://github.com/aokcuoglu/getirbakim/pull/1113)).
- **Order email state and resend** on `/yonetim/siparisler` ([#1116](https://github.com/aokcuoglu/getirbakim/pull/1116)).

### Fixed
- **Partner search vehicle fits from the whole match set:** guaranteed fits are taken from every search match (the storefront garage-lead intersection; a fit on a grouped secondary offer counts for its product) and listed first; production example `yağ filtresi` + Golf 1.6 TDI returned no fitting row before ([#1120](https://github.com/aokcuoglu/getirbakim/pull/1120), [#1119](https://github.com/aokcuoglu/getirbakim/issues/1119)).
- Codes prefixed with a multi-word brand name (VICTOR REINZ) match ([#1118](https://github.com/aokcuoglu/getirbakim/pull/1118); shipped in v0.34.0, missing from its notes).

### Deploy and operations
- **`db:setup` runs first** (`release-aws`): `partner_settings.order_intake_paused_at/by` ([#1113](https://github.com/aokcuoglu/getirbakim/pull/1113)) and `commerce_order_emails.requeued_at/by` ([#1116](https://github.com/aokcuoglu/getirbakim/pull/1116)); nullable, no backfill; the FKs take SHARE ROW EXCLUSIVE on `accounts` once.
- Resend needs the mail transport (SES production access is still pending). Vehicle oil specs are unchanged.

## v0.34.0 — 2026-11-20

Release of `dev` since v0.33.0 (14 pull requests): GetirBakım search inside BakımX work orders (fitting parts first, correct limits, caching, per-partner rate limit), Dinamik price-only parts as indexable unavailable pages and an enrichment tier, a new home hero, a compact cookie bar, a storefront button scale and enrichment worker fixes. Not deployed by this release; AWS production is released separately through `release-aws.yml`.

### Added
- **Partner product search for BakımX** (contract 1.3, `docs/partner-products-contract.md`): ranked over-fetch with `limit` up to 30 and exact part/OEM matches beyond rank 24; with `vehicleTypeId` fitting parts come first (guaranteed → likely → unknown, nothing filtered) and a new `fitmentLevel` field; 10-min ranked-id cache and 30 s answer cache ([#1100](https://github.com/aokcuoglu/getirbakim/pull/1100), [#1093](https://github.com/aokcuoglu/getirbakim/issues/1093)).
- **Dinamik price-list-only parts as product pages:** Dinamik codes without a stock-list row that carry an enrichment matched to their code and brand and a category with a Turkish label become unavailable cards named after that category ("Stok bilgisi bekleniyor", "Gelince haber ver", no price). Unlike other unavailable cards they are indexed and listed in the sitemap and IndexNow; never in the merchant feed, never orderable. Kept in `storefront_price_only_items` by `storefront_price_only_refresh()` ([#1068](https://github.com/aokcuoglu/getirbakim/issues/1068)).
- **Dinamik price-list-only codes as an enrichment tier:** spareto and parts2world give a configurable share of their pending pass (`--price-only-share` / `ENRICHMENT_PRICE_ONLY_SHARE`, default 0) to unlinked Dinamik codes without a stock-list row: spareto for brands enabled in `enrichment_price_only_brands`, parts2world for every brand matched to an archived article. New `enrichment:price-only` CLI (`enqueue`, `enable`, `disable`, `status`) and a progress card on `/yonetim/urun-verileri` → Kaynaklar ([#1075](https://github.com/aokcuoglu/getirbakim/issues/1075)).
- **Sticky phone header** with a compact search row ([#1109](https://github.com/aokcuoglu/getirbakim/pull/1109)).
- **Home hero** with a value proposition, trust line and static cards ([#1106](https://github.com/aokcuoglu/getirbakim/pull/1106)).
- **Compact cookie consent bar** that keeps the first screen visible ([#1092](https://github.com/aokcuoglu/getirbakim/pull/1092)).

### Changed
- **Storefront button scale:** one `storeButton({intent, size})` scale (44px minimum touch targets, one primary blue, visible focus outline, `--control-border` token) and larger footer controls ([#1101](https://github.com/aokcuoglu/getirbakim/pull/1101)).
- **Partner rate limit:** requests with a valid partner key are limited per partner (products 600/min, orders 300/min per task); the per-address limit (120 / 60) now counts failed key checks only, and an address over it gets 429 before the key check. BakımX sends every workshop's requests from one address ([#1100](https://github.com/aokcuoglu/getirbakim/pull/1100)).
- **`db:setup` lock window shorter:** `ANALYZE` and `refresh_search_vocabulary()` run after COMMIT (`scripts/setup-maintenance.ts`, ~40 s), per-file timing / lock-window log line, `--dry-run` ([#1112](https://github.com/aokcuoglu/getirbakim/pull/1112)).
- Price-only cards are searched through their own indexes (columns/indexes, view split; search fields filled on refresh) ([#1104](https://github.com/aokcuoglu/getirbakim/pull/1104)).
- Second parts2world collect worker through the egress proxy ([#1083](https://github.com/aokcuoglu/getirbakim/pull/1083)); explicit agent tool lists and English agent prompts ([#1080](https://github.com/aokcuoglu/getirbakim/pull/1080), [#1087](https://github.com/aokcuoglu/getirbakim/pull/1087)).

### Fixed
- spareto product photos served as `images_webp` are read ([#1078](https://github.com/aokcuoglu/getirbakim/pull/1078)); parts2world workers skip each other's tried rows ([#1095](https://github.com/aokcuoglu/getirbakim/pull/1095)).

### Deploy and operations
- **`db:setup` is required and runs first** (`release-aws` does it); the view replacements follow the outermost-first lock order of #1046.
- `db:setup` creates `storefront_price_only_items` and `storefront_price_only_runs` (first run only: `SHARE ROW EXCLUSIVE` on `supplier_items` for its foreign key until setup commits, as for earlier tables referencing it), replaces `commerce_unavailable_items`, `storefront_catalog_entries` and `storefront_catalog` (new `price_only` column at the end) and fills the list once; the app keeps it current afterwards ([#1068](https://github.com/aokcuoglu/getirbakim/issues/1068)).
- `db:setup` adds the price-only search columns and indexes and splits the price-only view ([#1104](https://github.com/aokcuoglu/getirbakim/pull/1104)); local dev search needs `db:setup` right after merging.
- `db:setup` adds `enrichment_price_only_brands` and the `price_only` value of `enrichment_source_attempts.queue` (guarded; a second run takes no lock). The tier stays off until `enrichment:price-only -- enqueue`, `enrichment:parts2world -- match`, `enable <brands>` and a non-zero share on the local workers (#1075).
- BakımX: `PARTNER_API_KEYS` holds BakımX's key since 2026-11-20 (set in the app secret, tasks restarted); BakımX accepts contract 1.3 (bakimx#756). On key rotation, 120 bad-key calls/min from BakımX's address lock out its valid traffic for that minute.
- Local only: spareto image fill ([#1078](https://github.com/aokcuoglu/getirbakim/pull/1078)), parts2world LaunchAgents restart / proxy worker ([#1083](https://github.com/aokcuoglu/getirbakim/pull/1083), [#1095](https://github.com/aokcuoglu/getirbakim/pull/1095)). Vehicle oil specs are unchanged.

## v0.33.0 — 2026-11-20

Release of `dev` since v0.32.1 (6 pull requests): saved addresses at checkout, order email through Amazon SES, two supplier-sync fixes that kept the Dinamik alarm open and delayed the nightly import, and removal of the unused `vehicle_brands.popular` column. The privacy text update (#1014) is held back (reverted in #1074) until its legal placeholders are filled.

### Added
- **Saved addresses at checkout:** approved service and admin accounts pick a saved delivery or invoice address on `/siparis-olustur` and can save a new one to their address book after a successful order (duplicates and a full book of 10 are skipped; saving never blocks the order) ([#1015](https://github.com/aokcuoglu/getirbakim/pull/1015), [#999](https://github.com/aokcuoglu/getirbakim/issues/999)).
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
