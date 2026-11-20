# Partner products contract (v1.3)

`GET /api/partner/v1/products` is the partner catalog search (#424). BakımX
calls it from a work order as the mechanic types (type-ahead). It uses the
storefront's search engine, ranking, visibility and prices: a partner never
sees a product or price the store would not sell. Partners get
supplier-backed parts only; hand-entered store products and products nobody
supplies now are left out.

Version 1.3 (#1093) is backwards compatible with 1.1 and 1.2: it adds
`fitmentLevel`, orders the parts that fit the requested vehicle first, honours
`limit` up to 30 and applies the exact number filters over a deeper part of
the ranking. A 1.2 reader ignores the new field and reads every other field
unchanged.

## Request

`Authorization: Bearer <key>` (`PARTNER_API_KEYS`). Answers are JSON with
`Cache-Control: no-store`.

| Parameter | Meaning |
| --- | --- |
| `partNo` | Exact manufacturer part number. Separators and case are ignored; a supplier's brand prefix is accepted (`LUK 510 0207 10` matches `510020710`). Matches the supplier code or the store's manufacturer part number. |
| `oem` | Exact OEM number: one of the product's OEM numbers or its own code. |
| `q` | Free text, the storefront header search. |
| `limit` | 1–30, default 20. Anything else is the default; larger values are cut to 30. |
| `vehicleTypeId` | Optional catalog vehicle type (`vehicle_types.id`, positive 32-bit integer). Orders and labels, **never filters**. An invalid value is `400 VALIDATION_ERROR`. |

Only one of `partNo`, `oem`, `q` is used, in that order of precedence. A text
shorter than `minQueryLength` (2) answers an empty list. Texts are cut to 120
characters.

## Response

```json
{ "products": [ … ], "source": "search", "minQueryLength": 2 }
```

`source` is `part_no`, `oem` or `search` (which parameter was used).

### Product

| Field | Meaning |
| --- | --- |
| `contractVersion` | `"1.3"`. |
| `id`, `sourceProductId` | Listing row id (the same value). |
| `partNo` | The supplier code the partner orders by. |
| `manufacturerPartNumber` | `{ value, normalized }`: the store's manufacturer part number. |
| `name`, `brandName`, `categoryName` | As the store shows them; `categoryName` may be null. |
| `oemNumbers`, `references` | OEM numbers (up to 12) and the same as `{ type: "OEM", value, normalized, brand: null }`. |
| `exactFitment` | `{ requestedVehicleTypeId, status, matchedVehicleTypeIds }`, unchanged from 1.2: `CONFIRMED` when the product is linked to the requested engine type, else `NOT_CONFIRMED`; `NOT_REQUESTED` without `vehicleTypeId`. |
| `fitmentLevel` | **1.3.** `"guaranteed"`, `"likely"`, `"unknown"`, or `null` without `vehicleTypeId` (see below). |
| `imageUrl` | Absolute URL or null. |
| `listPriceKurus`, `b2bPriceKurus`, `discountBps`, `vatRateBps`, `currency` | Informational B2B price, kuruş, VAT excluded (`PARTNER_B2B_DISCOUNT_BPS`, floored at cost). Null when the store cannot price the row. |
| `stockQty` | Always 0: stock counts are not shared. |
| `availability` | `IN_STOCK`, `SUPPLYABLE` or `UNAVAILABLE`. |
| `lastSyncedAt` | When the supplier price/stock was last observed (ISO-8601). Stock is not live: show its age. |
| `offers[]` | Every supplier offer grouped under the product: `selectedOfferId` (`offer_<32 hex>`, used to order), `supplierDisplayName`, `informationalPriceKurus` (undiscounted), `currency`, `vatRateBps`, `availability` (`IN_STOCK`/`SUPPLYABLE`/`UNKNOWN`), `stockQty: null`, `lastSyncedAt`. |

Prices are informational. Ordering goes through `POST /order-quotes`, which
prices every line again (docs/partner-order-contract.md).

## Ranking, limit and exact numbers

The search ranks matches the way the storefront does. The first 200 ranked
matches are read; the `partNo`/`oem` filters and the vehicle order work on
those 200, and `limit` is applied last. So an exact number is found even when
the free-text ranking puts it below the first result page, and `limit=30`
returns up to 30 parts. A match ranked below 200 is not returned.

## Fitment with `vehicleTypeId`

| `fitmentLevel` | `exactFitment.status` | Meaning |
| --- | --- | --- |
| `guaranteed` | `CONFIRMED` | Linked to this engine type (the store's "Araç tipine bağlı"). |
| `likely` | `NOT_CONFIRMED` | Fits the type's model, the engine type is not verified: an engine-level fit of another type of the same model, or a model read from the supplier's description (the store's "Model eşleşiyor, motor tipi doğrulanmadı"). |
| `unknown` | `NOT_CONFIRMED` | Neither, or the admin removed this engine type from the product. Not a statement that the part does not fit. |

A product fits when any of its grouped supplier offers fits. The levels follow
the storefront's fitment levels with these rules:

- An engine type the admin added counts as `guaranteed`; one the admin removed
  is never `guaranteed` or `likely` (the store shows a mismatch there; this
  endpoint never reports a mismatch and answers `unknown`).
- A model read from the supplier's description counts only as the store uses
  it: when the admin has not decided the product's vehicles and the offer has
  no trusted enrichment naming vehicles or vehicle models.
- One known difference: when the admin hid every enrichment vehicle and
  model of a product, the store falls back to the description models; this
  endpoint does not, and reports `unknown` there.

Order: `guaranteed` parts first, then `likely`, then the rest; inside each
group the search's ranking is kept. Nothing is filtered out: a part that does
not fit the vehicle is still returned after the fitting ones.

## Caching

- The ranked match list of a search is cached per application task for 10
  minutes (stale-while-revalidate, like the storefront search) and reloaded at
  once when an admin edit changes the listings. Prices and availability are
  not part of it.
- A whole answer is kept for 30 seconds per identical request (`source`, the
  text as the search reads it: case-folded and Turkish letters folded, with the
  typed words, `limit`, `vehicleTypeId`, discount), at most 100 answers per
  task. It is never served after
  30 seconds; a type-ahead repeating a request within that window gets the
  same answer without a new search or price read. Nothing partner-specific is
  in the answer: the discount is one setting for every partner.

## Limits and errors

- A request with a valid key is limited per partner key only: 600 requests a
  minute, whatever address it comes from (a partner's server carries all of its
  workshops). Requests with a missing or wrong key count per client address:
  120 a minute; an address over it is refused before its key is checked.
  Counted per application task; over a limit `429 RATE_LIMITED` with
  `Retry-After`.
- `401 UNAUTHORIZED` without a valid key, `400 VALIDATION_ERROR` for an
  invalid `vehicleTypeId`, `500 INTERNAL_ERROR` when the search fails.
- Error body: `{ "error": { "code", "message" } }`.

## Versions

- **1.3** (#1093): `fitmentLevel`; fitting parts first; `limit` up to 30
  honoured; exact filters over the first 200 matches; 30-second answer cache.
- **1.2** (#424): the endpoint's first version here, the shape BakımX's
  1.1/1.2 parser reads.
