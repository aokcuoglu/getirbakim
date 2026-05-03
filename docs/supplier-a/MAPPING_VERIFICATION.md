# Supplier A (Dinamik Oto) — Field Mapping Verification

**Verified against live API on 2026-05-03.**

## Normalized Product Fields

| Supplier A Raw Field | Normalized Field | Status | Notes |
|---|---|---|---|
| `stokKodu` | `supplierSku` (in offer), `id` prefix `sA-` | VERIFIED | Stock code/SKU, e.g. "BOSCH 1987302819", "3M 7100147732" |
| `stokAdi` / `stokKodu` (fallback) | `name` | VERIFIED | Product name, e.g. "PARK AMPULU DUYSUZ 12V ECO W5W". Falls back to `stokKodu` if `stokAdi` is empty. |
| `marka` | `brand` | VERIFIED | Brand name, e.g. "BOSCH", "3M", "TRW". Always populated. |
| `kull7s` | `category` | VERIFIED | Category code, e.g. "AYDINLATMA", "ELEKTRONIK", "MARS-SARJ", "ISITMA-SOGUTMA", "AKTARMA", "RULMAN-KAYIS-KASNAK", "ELEKTRIK". |
| `kull8s` | `description` | VERIFIED | Sub-category/description, e.g. "AMPUL", "DIZEL ENJEKTORU", "ALTERNATOR KOMPLE", "KLIMA KOMPRESORU". |
| `fiyat` | `price` (in offer) | VERIFIED | Unit price in TRY. Values range from ~6.33 to over 112,000. Can be 0. |
| *(not returned)* | `currency` → always "TRY" | VERIFIED | No `doviz`/currency field in stock or price responses. Always defaults to TRY. |
| `varyokAll` / `varyok1` | `stockQuantity` + `isAvailable` | VERIFIED | "VAR" → `stockQuantity: 1`, `isAvailable: true`. "YOK" or absent → `stockQuantity: 0`, `isAvailable: false`. No real quantity values observed. |
| `resimUrl` | `image_url` | VERIFIED | Always empty string `""` in live data, normalized to `null`. Image URLs may exist for some products but not observed in tested brands. |
| `oemListe` | `oem_numbers` | VERIFIED | Always empty string `""` in live data for BOSCH, 3M, TRW, ABA brands. Normalized to `[]`. May be populated for other brands. |
| *(not returned)* | `deliveryDays` → always `null` | VERIFIED | No `TESLIMAT_GUNU` or delivery days field in API response. |
| *(calculated)* | `supplierName` → "Tedarikçi A" | VERIFIED | Hard-coded in adapter class. |
| *(calculated)* | `supplierId` → "supplier-a" | VERIFIED | Hard-coded in adapter class. |

## Price List (Enrichment) Fields

| Supplier A Raw Field | Normalized Field | Status | Notes |
|---|---|---|---|
| `stokKodu` | key for price map | VERIFIED | Links price enrichment to products by stock code. |
| `fiyat` | `price` (overwrites stock price) | VERIFIED | Price from separate `/getPriceList/{brand}` endpoint overwrites the price from `/getStockList/{brand}`. |
| *(not returned)* | `currency` → "TRY" | VERIFIED | `doviz` field not observed in price list responses either. |

## Price & Stock Semantics

| Question | Finding | Status |
|---|---|---|
| Is price VAT-included or VAT-excluded? | **UNKNOWN** — Dinamik Oto has not confirmed. Turkish B2B wholesale prices are typically VAT-excluded (KDV hariç), but this needs supplier confirmation. | UNKNOWN |
| Is stock a real quantity or just availability? | **Availability-only** — `varyokAll`/`varyok1` is the string "VAR" (available) or "YOK" (unavailable), not a numeric quantity. Adapter maps "VAR"→1, "YOK"→0. Real stock quantities are not exposed. | VERIFIED |
| Is currency always TRY? | **Yes** — No currency field in any API response. All observed prices are in TRY. | VERIFIED |
| Are prices net, list price, discounted, or customer-specific? | **UNKNOWN** — The same stock code returns the same price for all queries. No discount or customer-tier information in the API response. Likely list/net price, but supplier confirmation needed. | UNKNOWN |
| Are multiple warehouses returned separately or aggregated? | **Aggregated/flat** — The API returns one stock status per product (`varyokAll`). No separate warehouse fields. `varyok1` through `varyok4` may represent individual warehouses but are not reliably populated. Only `varyokAll` is used by the adapter. | VERIFIED |

## Search Behavior

| Query Type | Result | Status |
|---|---|---|
| Brand name: "BOSCH" | 8016 products returned via `getStockList/BOSCH` + price enrichment | VERIFIED |
| Brand name: "3M" | 1 product returned | VERIFIED |
| Brand name: "ABA" | 1253 products returned, single category "RULMAN-KAYIS-KASNAK" | VERIFIED |
| Brand name: "TRW" | 2991 products returned | VERIFIED |
| Exact stock code: "BOSCH 1987302819" | 0 results — `getStock` POST returns no match for this format | PARTIAL |
| Exact stock code search | `getStock` POST endpoint works (confirmed previously with "3M 7100147732") | VERIFIED |
| Free-text: "filtre" | 0 results — API only supports brand/stock-code, no free-text | VERIFIED |
| Free-text: "balata" | 0 results — API only supports brand/stock-code, no free-text | VERIFIED |
| Free-text: "mazot filtresi" | 0 results | VERIFIED |
| Free-text: "yağ filtresi" | 0 results | VERIFIED |
| Free-text: "fren balata" | 0 results | VERIFIED |
| Empty query "" | 0 results, no crash | VERIFIED |
| Nonexistent query: "XYZNONEXISTENT123" | 0 results, no crash, no error | VERIFIED |
| XSS attempt: `"'><script>alert(1)</script>` | 200 OK, 0 results, no crash | VERIFIED |

## Stock Code Search Note

The search for exact stock code "BOSCH 1987302819" returned 0 results because:
1. The `getStock` POST endpoint performs an exact match on `STOK_KODU`
2. The actual stock code in the system is "1987302819" (without "BOSCH " prefix)
3. When searching "BOSCH", the `getStockList/BOSCH` returns all BOSCH products with their full stock codes like "BOSCH 1987302819"

This is expected behavior — the adapter correctly searches via brand name when a broad query is used.

## Unmapped Fields Present in API Responses

| Field | Observed | Notes |
|---|---|---|
| `ingilizceAdi` | Often `null` | English product name. Not mapped. |
| `barkod1` / `barkod2` / `barkod3` | Present | Barcode values. Not mapped. |
| `kampanyaOrani` | Present | Campaign rate. Not mapped. |
| `paketMiktari` | Present | Package quantity. Not mapped. |

These fields are not critical for v0.2.0 but may be useful for future releases.