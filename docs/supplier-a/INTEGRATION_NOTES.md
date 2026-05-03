# Supplier A (Dinamik Oto) — Integration Notes

## Overview

Supplier A is **Dinamik Oto** (Dinamik Otomotiv), a Turkish automotive spare parts distributor. Their API is hosted at a configurable URL via `SUPPLIER_A_BASE_URL`.

## Base URL

Configurable via `SUPPLIER_A_BASE_URL` env var.

## Authentication

The API uses **two custom headers** — no OAuth, no token endpoint:

| Header      | Env Var                  | Description     |
|-------------|--------------------------|-----------------|
| `ApiKey`    | `SUPPLIER_A_API_KEY`     | Public API key  |
| `SecretKey` | `SUPPLIER_A_SECRET_KEY` | Secret API key  |

There is also an alternative path-based auth (API key in URL path), but we use the **header-based approach** exclusively because it avoids exposing credentials in URLs/logs.

## Endpoints Used

### 1. Search by Stock Code — `POST /api/Dnmk_Customer/getStock`

Returns a single product by its stock code (STOK_KODU).

- **Method**: POST
- **Headers**: `ApiKey`, `SecretKey`, `Content-Type: application/json`
- **Body**: `{ "STOK_KODU": "<stock_code>" }`
- **Purpose**: Product detail lookup; exact-match search when query looks like a stock code

### 2. Stock List by Brand — `GET /api/Dnmk_Customer/getStockList/{brand}`

Returns all products for a given brand name (URL-encoded).

- **Method**: GET
- **Headers**: `ApiKey`, `SecretKey`
- **Path param**: `{brand}` — brand name (URL-encoded)
- **Purpose**: Brand-level product search

### 3. Price List by Brand — `GET /api/Dnmk_Customer/getPriceList/{brand}`

Returns pricing for all products of a given brand.

- **Method**: GET
- **Headers**: `ApiKey`, `SecretKey`
- **Path param**: `{brand}` — brand name (URL-encoded)
- **Purpose**: Price data for stock list results

### 4. Brand List — `GET /api/Dnmk_Customer/getBrandList`

Returns the full list of available brands.

- **Method**: GET
- **Headers**: `ApiKey`, `SecretKey`
- **Purpose**: Health check + brand validation

## Endpoints NOT Used (XML Variants)

The API also exposes `*Xml` endpoints (e.g., `getStockListXml`, `getStockXml`, `getPriceListXml`, `getBrandListXml`) and path-auth variants (e.g., `BrandList/{key}`, `StockList/{key}/{brand}`). We skip these because:

- JSON endpoints are preferred over XML
- Header-based auth is preferred over path-based auth (no credentials in URLs)

## Search Strategy

Since the API has **no free-text search endpoint**, our adapter implements search as:

1. **Exact stock code lookup**: Call `getStock` with the query as `STOK_KODU`
2. **Brand-level search**: Call `getStockList` with the query as brand name
3. **Price enrichment**: If brand search returns results, also call `getPriceList` for the same brand to merge pricing data
4. Results are deduplicated and normalized

## Environment Variables

| Variable                    | Required | Default                                        | Description                            |
|-----------------------------|----------|------------------------------------------------|----------------------------------------|
| `SUPPLIER_A_ENABLED`        | Yes      | `false`                                        | Enable Supplier A adapter              |
| `SUPPLIER_A_BASE_URL`       | Yes      | —                                              | API base URL                          |
| `SUPPLIER_A_API_KEY`        | Yes      | —                                              | ApiKey header value                    |
| `SUPPLIER_A_SECRET_KEY`     | Yes      | —                                              | SecretKey header value                 |
| `SUPPLIER_A_TIMEOUT_MS`    | No       | `8000`                                         | Request timeout in milliseconds        |
| `SUPPLIER_A_USE_PROXY`     | No       | `false`                                        | Route requests through proxy           |
| `SUPPLIER_A_PROXY_URL`     | No       | —                                              | Proxy URL (only if USE_PROXY=true)     |

## Sample Request Structure

### getStock (search by stock code)

```
POST {BASE_URL}/api/Dnmk_Customer/getStock
Headers:
  ApiKey: <SUPPLIER_A_API_KEY>
  SecretKey: <SUPPLIER_A_SECRET_KEY>
  Content-Type: application/json
Body:
  { "STOK_KODU": "TRW GDB400" }
```

### getStockList (search by brand)

```
GET {BASE_URL}/api/Dnmk_Customer/getStockList/{brand}
Headers:
  ApiKey: <SUPPLIER_A_API_KEY>
  SecretKey: <SUPPLIER_A_SECRET_KEY>
```

### getPriceList (prices by brand)

```
GET {BASE_URL}/api/Dnmk_Customer/getPriceList/{brand}
Headers:
  ApiKey: <SUPPLIER_A_API_KEY>
  SecretKey: <SUPPLIER_A_SECRET_KEY>
```

## Response Mapping

**VERIFIED against live API responses on 2026-05-02.**

The Dinamik Oto API returns **camelCase** field names (not UPPER_CASE Turkish). The adapter was updated accordingly.

### Stock Item Fields (getStock, getStockList)

| API Field (camelCase) | Normalized DTO Field | Verified | Notes |
|---|---|---|---|
| `stokKodu` | `supplierSku` | ✅ | Stock code / SKU, e.g. "ABA 3PK668" |
| `stokAdi` | `name` | ✅ | Product name, e.g. "ALTERNATOR KAYISI" |
| `marka` | `brand` | ✅ | Brand name, e.g. "ABA", "3M", "TRW" |
| `kull7s` | `category` | ✅ | Category, e.g. "RULMAN-KAYIS-KASNAK" |
| `kull8s` | `description` | ✅ | Sub-category, e.g. "V KAYIS GERGISI" |
| `fiyat` | `price` | ✅ | Unit price in TRY, e.g. 133.99 |
| `resimUrl` | `imageUrl` | ✅ | Image URL (often empty string "") |
| `oemListe` | `oemNumbers` | ✅ | OEM numbers (often empty string in practice) |
| `varyokAll` / `varyok1` | `stockQuantity` / `isAvailable` | ✅ | "VAR" = available (qty=1), "YOK" = unavailable (qty=0) |
| `ingilizceAdi` | *(not mapped)* | — | English name (often null) |
| `barkod1`/`barkod2`/`barkod3` | *(not mapped)* | — | Barcodes |
| `kampanyaOrani` | *(not mapped)* | — | Campaign rate |
| `paketMiktari` | *(not mapped)* | — | Package quantity |

### Price Item Fields (getPriceList)

| API Field (camelCase) | Normalized DTO Field | Verified | Notes |
|---|---|---|---|
| `stokKodu` | key for price map | ✅ | Links prices to products |
| `fiyat` | `price` | ✅ | Unit price |
| *(currency not returned)* | `currency` | ✅ | Defaults to "TRY" |

### Key Differences from Original Assumptions

1. **All field names are camelCase**, not UPPER_CASE. The original `STOK_KODU` assumption was wrong — it's `stokKodu`.
2. **No currency field** in response. All prices are in TRY; the adapter defaults to "TRY".
3. **No `ADET` / `STOK_MIKTARI` quantity field**. Stock availability is indicated by `varyokAll` ("VAR" = available, "YOK" = unavailable). The adapter maps "VAR" to qty=1 and "YOK" to qty=0.
4. **No `TESLIMAT_GUNU` delivery days field**. Not present in live responses.
5. **No `KATEGORI` / `GRUP` field**. Category is in `kull7s`.
6. **No `ACIKLAMA` description field**. Sub-category info is in `kull8s`.
7. **`oemListe` is often empty string**. OEM data may not be populated for most products.
8. **`resimUrl` is often empty string**. The adapter treats empty strings as null.
9. **POST body field for `getStock` uses UPPER_CASE**: `{ "STOK_KODU": "..." }` (request), but response uses camelCase: `{ "stokKodu": "..." }`.
10. **getStock returns an array**, not a single object. The adapter's `parseSingleStockResponse` correctly handles this.

## Pagination

No pagination parameters are visible in the Postman Collection. The API appears to return full result sets. If results are large, we may need to add client-side limiting.

## Error Response Shape

Unknown. The Postman Collection contains no response examples. The adapter handles:
- HTTP 4xx/5xx → return empty results + error message
- Network errors → return empty results + error message
- Timeout (AbortController) → return empty results + error message
- All errors are caught; never throws to caller; partial failure is preserved

## Known Limitations

1. **No free-text search**: The API only supports brand-based listing and exact stock code lookup. Full-text keyword search is not available.
2. **No response examples**: The Postman Collection has no response data, so field mappings are estimates based on Turkish ERP conventions.
3. **No pagination info**: Unknown if results are paginated or if there are limits on result set size.
4. **No health endpoint**: No dedicated health check. We use `getBrandList` as a liveness check.
5. **Price is a separate call**: Stock and price data require separate API calls; must be merged client-side.
6. **Static IP whitelist required**: The Dinamik Oto API requires a whitelisted static IP. Requests from non-whitelisted IPs will fail with connection/SSL errors. The VPS static IP must be configured with the supplier. Docker containers need network access through the whitelisted IP or a proxy.

## Proxy Configuration

The Dinamik Oto API requires requests from a whitelisted static IP. Two deployment modes are supported:

### Local Development (proxy mode)

Route Supplier A requests through a whitelisted proxy:

```
SUPPLIER_A_USE_PROXY=true
SUPPLIER_A_PROXY_URL=http://your-proxy-host:port
```

The adapter uses `undici.ProxyAgent` to route only Supplier A HTTP requests through the proxy. Other suppliers and app traffic are unaffected.

### Contabo Production (direct mode)

The app runs on the VPS with the whitelisted IP, so no proxy is needed:

```
SUPPLIER_A_USE_PROXY=false
SUPPLIER_A_PROXY_URL=
```

### Proxy Implementation

- Uses `undici.ProxyAgent` as a `dispatcher` option on each `fetch` call
- Only affects Supplier A adapter requests — no global `HTTP_PROXY`/`HTTPS_PROXY` env vars
- Proxy URL is never exposed to the frontend (no `NEXT_PUBLIC_` prefix)
- Proxy credentials in URLs are masked in logs: `http://user:pass@host:port` → `http://***:***@host:port`
- Each log entry includes `proxyUsed: true/false`

## Connectivity Diagnostics

### Test proxy connectivity (local):

```bash
curl -x http://your-proxy-host:port https://api.ipify.org
```

Expected result: your whitelisted static IP

### Test direct connectivity (VPS):

```bash
curl https://api.ipify.org
```

Expected result: your whitelisted static IP

### Test Supplier A API via proxy:

```bash
curl -x http://your-proxy-host:port \
  -H "ApiKey: <YOUR_KEY>" \
  -H "SecretKey: <YOUR_SECRET>" \
  https://your-supplier-base-url/api/Dnmk_Customer/getBrandList
```

Expected result: JSON array of brands

## Unanswered Questions

1. **What are the actual response field names?** No sample responses are available. The normalize functions use common Turkish ERP field names as best guesses.
2. **Is there pagination?** If brand stock lists can return thousands of items, do we need to handle pagination?
3. **What does an error response look like?** Is it JSON with error details, or just HTTP status codes?
4. **What HTTP status codes does the API return?** 401 for bad credentials? 404 for not found? 429 for rate limiting?
5. **Are there rate limits?** The Postman Collection doesn't mention any.
6. **Can `getStockList` accept partial brand names?** Or must the brand name be exact?
7. **Does `getStock` support wildcard/partial matching?** Or is it strictly exact match on STOK_KODU?
8. **Are all currencies supported?** Is TRY always the default?

## v0.2.0 Validation Results (2026-05-02)

### Infrastructure & Security

- [x] `.env` is gitignored
- [x] `.env.example` had real API credentials — **FIXED**: replaced with placeholders
- [x] API keys and secrets never appear in logs (verified: `logSupplierCall` only logs status, duration, error)
- [x] API keys and secrets never appear in API responses (no serialization of adapter config)
- [x] Docker compose defaults are empty/safe — no credentials in `docker-compose.yml`
- [x] Admin auth remains fail-closed (`ADMIN_PASSWORD` empty → 401)
- [x] Rate limiter works correctly
- [x] Cache only stores successful results, never errors

### Build & Deploy

- [x] `npm run lint` — PASS
- [x] `npm run typecheck` — PASS
- [x] `npm run build` — PASS
- [x] `docker compose config` — valid, no leaked secrets
- [x] `docker compose build --no-cache` — PASS
- [x] Container starts and serves requests on port 3001

### Mock Mode

- [x] Search "filtre" → 2 results (Yağ Filtresi, Hava Filtresi)
- [x] Search "balata" → 1 result (Ön Balata Seti)
- [x] `lastCheckedAt` populated correctly
- [x] No errors in mock mode

### Live Mode Validation

- **Status: PASS** — live API access verified via proxy
- Proxy configuration: `SUPPLIER_A_USE_PROXY` / `SUPPLIER_A_PROXY_URL` (VPS static IP, details in env)
- SSL: requires `NODE_EXTRA_CA_CERTS=/app/certs/sectigo-intermediate.pem` for Dinamik Oto's incomplete cert chain
- Auth headers (`ApiKey`/`SecretKey`) correctly implemented; API returns 200 with valid credentials
- Health check: `isHealthy: true`, `responseTimeMs: ~1000ms`
- Search by brand: "ABA" returns 1253 products, "3M" returns 1 product
- Search by stock code: `POST getStock` with `{ STOK_KODU: "3M 7100147732" }` returns correct single item
- Price enrichment: `getPriceList` returns prices per product for each brand
- Field mappings: all verified against live responses (see Field Mapping section)
- No API keys or secrets appear in logs or API responses
- Error category when credentials are wrong: **AUTH_FAILED** (HTTP 401)

### Bugs Found & Fixed

1. **`.env.example` leaked real API credentials** — Replaced with placeholder values. (Critical)
2. **Live mode adapter filtering bug** — `getAllAdapters()` in `live` mode did not check `isSupplierAEnabled()` or verify `apiKey`/`baseUrl` for any adapter. Fixed to filter properly. (`src/suppliers/index.ts`)
3. **`AGENTS.md` missing `SUPPLIER_A_SECRET_KEY`** — Added to env variables section.
4. **Dockerfile missing CA certificates** — Added `ca-certificates` package to Alpine image.
5. **Field mappings used UPPER_CASE instead of camelCase** — All API response fields are camelCase (e.g., `stokKodu` not `STOK_KODU`). Updated all mappers and adapter code. (`src/suppliers/supplier-a-mappers.ts`, `src/suppliers/supplier-a.ts`)
6. **Stock availability was mapped from numeric `ADET`/`STOK_MIKTARI` fields** — Actually uses `varyokAll`/`varyok1` string fields ("VAR"/"YOK"). Updated mapper.
7. **No proxy support** — Added `SUPPLIER_A_USE_PROXY` and `SUPPLIER_A_PROXY_URL` env vars with `undici.ProxyAgent` integration.
8. **Dinamik Oto SSL certificate chain incomplete** — Added Sectigo intermediate cert to container and `NODE_EXTRA_CA_CERTS` env var support.

### Field Mapping Verification Status

Verified against live API on 2026-05-02 (proxy mode):

| API Field | Normalized To | Verified |
|---|---|---|
| `stokKodu` | `supplierSku` | ✅ |
| `stokAdi` | `name` | ✅ |
| `marka` | `brand` | ✅ |
| `kull7s` | `category` | ✅ |
| `kull8s` | `description` | ✅ |
| `fiyat` | `price` | ✅ |
| (missing) | `currency` → always TRY | ✅ |
| `varyokAll`/`varyok1` | `stockQuantity`/`isAvailable` | ✅ |
| `resimUrl` | `imageUrl` | ✅ (often empty) |
| `oemListe` | `oemNumbers` | ✅ (often empty) |

### Remaining Supplier A Questions

1. ~~Verify field mappings against real API responses~~ — ✅ Done, all fields verified
2. Confirm error response shapes (HTTP status codes, JSON error bodies) — Unknown, adapter handles errors gracefully
3. ~~Test search for "filtre", "balata"~~ — ✅ Verified: returns 0 results (API only supports brand/stock-code search)
4. Test partial brand name matching in `getStockList` — Not verified, use full brand names
5. ~~Confirm SSL certificate chain handling on VPS (direct)~~ — ✅ NODE_EXTRA_CA_CERTS needed for local proxy; Docker container includes certs at `/app/certs/`
6. ~~Currency field not present in response~~ — ✅ Confirmed: always TRY
7. ~~No `deliveryDays` field in response~~ — ✅ Confirmed: always null
8. ~~OEM data (`oemListe`) is often empty~~ — ✅ Confirmed: empty for BOSCH, 3M, TRW, ABA brands

### v0.2.0 Live Validation Results (2026-05-03)

#### Queries Tested

| Query | Results | Notes |
|---|---|---|
| Bosch | 8016 | Brand search via `getStockList/BOSCH`, price enrichment via `getPriceList/BOSCH` |
| 3M | 1 | Single product "IZOLEBANT SIYAH 18mm" |
| ABA | 1253 | All in category "RULMAN-KAYIS-KASNAK" |
| TRW | 2991 | Brand search, includes brake pads |
| filtre | 0 | API has no free-text search |
| balata | 0 | API has no free-text search |
| mazot filtresi | 0 | API has no free-text search |
| yağ filtresi | 0 | API has no free-text search |
| fren balata | 0 | API has no free-text search |
| BOSCH 1987302819 | 0 | Stock code search uses exact match; full "BOSCH " prefix format |
| XYZNONEXISTENT123 | 0 | No crash, graceful empty result |

#### Field Mapping Verification

All mapped fields verified against live data. See `MAPPING_VERIFICATION.md` for full details.

#### Key Observations

- **No free-text search**: The API supports brand name lookup and exact stock code lookup only. Turkish keywords like "filtre", "balata" return 0 results.
- **Stock is availability-only**: `varyokAll` ("VAR"/"YOK") maps to available/unavailable, not real quantity.
- **No OEM numbers in tested brands**: BOSCH, 3M, TRW, ABA all return empty `oemListe`.
- **No images in tested brands**: `resimUrl` is always empty string, normalized to null.
- **Price enrichment works**: `getPriceList` overwrites prices from `getStockList`.
- **VAT/price type unknown**: Prices could be VAT-included or excluded; needs supplier confirmation.
- **8016 products for BOSCH alone**: API returns full brand catalogs without pagination

## Live Validation Plan (before v0.2.0 tag)

### Prerequisites

- Dinamik Oto API credentials configured in `.env`
- Static IP whitelisting required
- Either: app running on Contabo VPS (direct mode), or local with proxy enabled

### Configuration

**Local live testing:**
```
SUPPLIER_MODE=live
SUPPLIER_A_ENABLED=true
SUPPLIER_A_USE_PROXY=true
SUPPLIER_A_PROXY_URL=http://your-proxy-host:port
SUPPLIER_A_API_KEY=<your-api-key>
SUPPLIER_A_SECRET_KEY=<your-secret-key>
SUPPLIER_A_BASE_URL=https://your-supplier-base-url
```

**Contabo production:**
```
SUPPLIER_MODE=live
SUPPLIER_A_ENABLED=true
SUPPLIER_A_USE_PROXY=false
SUPPLIER_A_PROXY_URL=
```

### Test Queries

1. **"filtre"** — should return filter products with brand, price, stock
2. **"balata"** — should return brake pad products
3. **Known OEM/product code** — verify exact stock code lookup

### Verification Checklist

For each query, verify:
- [ ] API request succeeds (200) or fails gracefully (no crash)
- [ ] No API key or secret appears in logs or responses
- [ ] Search page renders without errors
- [ ] Partial failure: if Supplier A fails, mock/other suppliers still return results (in hybrid mode)
- [ ] `product.code` (STOK_KODU) → `supplierSku` mapped correctly
- [ ] `product.name` (STOK_ADI) → `name` mapped correctly
- [ ] `product.brand` (MARKA) → `brand` mapped correctly
- [ ] `product.price` (FIYAT) → `price` mapped correctly
- [ ] `product.currency` (DOVIZ_KODU) → `currency` mapped correctly
- [ ] `product.stock` (ADET/STOK_MIKTARI) → `stockQuantity` mapped correctly
- [ ] `product.oemNumbers` (OEM/OEM_NO) → `oemNumbers` mapped correctly
- [ ] `lastCheckedAt` is populated in response
- [ ] Supplier API logs show: status, duration, `proxyUsed: true/false` — no secrets