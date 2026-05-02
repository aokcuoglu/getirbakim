# Supplier A (Dinamik Oto) — Integration Notes

## Overview

Supplier A is **Dinamik Oto** (Dinamik Otomotiv), a Turkish automotive spare parts distributor. Their API is hosted at `dinamikapp-api.dinamik.online`.

## Base URL

```
https://dinamikapp-api.dinamik.online
```

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

Since no sample responses are provided in the Postman Collection, mapping is based on common Turkish automotive ERP field names. Expected field names and their normalizations:

| Supplier A Field (expected) | Normalized DTO Field | Notes                         |
|-----------------------------|----------------------|-------------------------------|
| `STOK_KODU`                 | `supplierSku`        | Stock code / SKU              |
| `STOK_ADI`                  | `name`               | Product name                  |
| `MARKA`                     | `brand`              | Brand name                    |
| `KATEGORI` / `GRUP`        | `category`           | Category                      |
| `OEM` / `OEM_NO`           | `oemNumbers`         | OEM number(s)                 |
| `FIYAT`                     | `price`              | Unit price                    |
| `DOVIZ` / `DOVIZ_KODU`     | `currency`           | Currency code (TRY, USD, EUR) |
| `STOK_MIKTARI` / `ADET`    | `stockQuantity`       | Available quantity            |
| `ACIKLAMA`                  | `description`        | Description                   |
| `RESIM` / `IMAGE_URL`       | `imageUrl`           | Product image URL             |
| `TESLIMAT_GUNU`            | `deliveryDays`       | Estimated delivery days       |

**Important**: These field mappings are best-effort guesses. When real API access is obtained, verify actual response field names and update `normalizeProduct()` accordingly.

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

## Unanswered Questions

1. **What are the actual response field names?** No sample responses are available. The normalize functions use common Turkish ERP field names as best guesses.
2. **Is there pagination?** If brand stock lists can return thousands of items, do we need to handle pagination?
3. **What does an error response look like?** Is it JSON with error details, or just HTTP status codes?
4. **What HTTP status codes does the API return?** 401 for bad credentials? 404 for not found? 429 for rate limiting?
5. **Are there rate limits?** The Postman Collection doesn't mention any.
6. **Can `getStockList` accept partial brand names?** Or must the brand name be exact?
7. **Does `getStock` support wildcard/partial matching?** Or is it strictly exact match on STOK_KODU?
8. **Are all currencies supported?** Is TRY always the default?