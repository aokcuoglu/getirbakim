# Partner order contract (v2.0)

Partner orders (#426) let a partner (BakımX) order parts found through
`GET /api/partner/v1/products` for delivery to a workshop. Version 2.0 replaces
the 1.0 pilot (single line, reservation TTL, `RESERVATION_EXPIRED`); it is not
backwards compatible.

All endpoints live under `/api/partner/v1`, take `Authorization: Bearer <key>`
(`PARTNER_API_KEYS`), answer JSON with `Cache-Control: no-store`, and share a
limit of 60 requests per minute per client address (`429 RATE_LIMITED` with
`Retry-After`). The partner identity comes only from the key: request bodies
are strict and refuse unknown fields, including any partner field.

Amounts are integer kuruş in TRY. `*NetKurus` excludes VAT, `*VatKurus` is the
VAT, `*GrossKurus` = net + VAT. VAT is computed per unit, half up
(`round(unitNet × vatRateBps / 10000)`), and line/order totals are unit amounts
times quantity.

## Flow

1. Pick offers from the products endpoint (`offers[].selectedOfferId`, format
   `offer_<32 hex>`). Catalog prices are informational.
2. `POST /order-quotes` with the lines. The answer is binding for 15 minutes
   and carries a signed `confirmationToken`. Nothing is reserved.
3. `POST /orders` with an `Idempotency-Key` header, the token, the same lines
   with `expectedUnitNetKurus` = the quoted `unitNetKurus`, and the workshop's
   shipping address.
4. Follow the order with `GET /orders/:id` or `GET /orders/by-key/:key`
   (no webhooks yet).

## POST /order-quotes

```json
{ "lines": [ { "selectedOfferId": "offer_0000a569053e4b84a484d510f04fab3b", "quantity": 2 } ] }
```

1–20 lines, each offer once, quantity 1–99. Answer `200`:

```json
{ "quote": {
  "contractVersion": "2.0",
  "lines": [ { "selectedOfferId": "offer_…", "quantity": 2, "unitNetKurus": 13000, "unitVatKurus": 2600, "unitGrossKurus": 15600, "vatRateBps": 2000 } ],
  "totals": { "netKurus": 26000, "vatKurus": 5200, "shippingKurus": 0, "grossKurus": 31200 },
  "currency": "TRY",
  "expiresAt": "2026-11-18T10:15:00.000Z",
  "confirmationToken": "<opaque>"
} }
```

The unit price is the partner's B2B price before VAT (`PARTNER_B2B_DISCOUNT_BPS`
applied, never below cost), from the storefront's current saved price. Only
supplier offers the storefront sells right now can be quoted.

## POST /orders

Headers: `Idempotency-Key: <UUID>` (required).

```json
{
  "confirmationToken": "<from the quote>",
  "lines": [ { "selectedOfferId": "offer_…", "quantity": 2, "expectedUnitNetKurus": 13000 } ],
  "shippingAddress": {
    "recipientName": "Usta Oto Servis",
    "phone": "0532 000 00 00",
    "email": "servis@example.com",
    "province": "İstanbul",
    "district": "Kadıköy",
    "addressLine": "Test Mahallesi 1. Sokak No 2",
    "postalCode": "34710"
  },
  "note": "optional, up to 1000 characters"
}
```

- `lines` must be exactly the quoted lines (any order).
- `email` and `postalCode` are optional. Province and district must be a
  Turkish province and one of its districts, matched ignoring case and stored
  with the official spelling; a postal code must belong to the province.
- Answer `201 { "order": <Order>, "replayed": false }`.
- The same key with the same body answers `200 { "order": <the original>, "replayed": true }`,
  even after the quote expired. The body is compared after validation
  (field order, letter case of province/district and surrounding spaces do not
  matter; line order does).
- The same key with another body is `409 IDEMPOTENCY_CONFLICT`.
- Keys are per partner: another partner's key never collides.

At order time the server, in this order: replays a known key; refuses when
ordering is not configured; verifies the token (partner, lines, expiry); checks
the suppliers live (the storefront's checkout rule, `supplier-checkout-policy`:
Başbuğ, SETA and Dinamik are asked for these codes when the live mode is on; a
supplier that does not answer leaves the line on its fresh saved data, marked
for operations); then, under a per-partner lock, re-prices every line, checks
the open-order limit and creates the order.

**Payment is on account.** No payment is taken; GetirBakım invoices the partner
later. Shipping is not charged on partner orders (`shippingKurus: 0`).

**Open-order limit.** The gross total of the partner's orders that are neither
cancelled nor delivered, plus the new order, must not exceed
`PARTNER_ORDER_LIMIT_KURUS` (VAT included). An unset limit refuses every order
(`503 ORDER_LIMIT_UNAVAILABLE`).

## GET /orders/:id and GET /orders/by-key/:key

`200 { "order": <Order> }`. Only the calling partner's orders are visible;
anything else, including a malformed id or key, is `404 ORDER_NOT_FOUND`.
`by-key` lets a client whose create call timed out find out whether the order
exists before retrying.

## Order

```json
{
  "contractVersion": "2.0",
  "id": "uuid", "number": 1042, "idempotencyKey": "uuid",
  "status": "REQUESTED",
  "paymentStatus": "ON_ACCOUNT",
  "currency": "TRY",
  "totals": { "netKurus": 26000, "vatKurus": 5200, "shippingKurus": 0, "grossKurus": 31200 },
  "lines": [ { "selectedOfferId": "offer_…", "partNo": "LUK 510 0207 10", "name": "…", "quantity": 2,
               "unitNetKurus": 13000, "unitVatKurus": 2600, "unitGrossKurus": 15600, "vatRateBps": 2000 } ],
  "shippingAddress": { "recipientName": "…", "phone": "…", "email": null, "province": "İstanbul", "district": "Kadıköy", "addressLine": "…", "postalCode": null },
  "note": "",
  "shipment": null,
  "cancelledBy": null, "cancelledAt": null,
  "createdAt": "2026-11-18T10:01:00.000Z"
}
```

`shipment` is set once the order ships:
`{ "carrier", "trackingNo", "trackingUrl", "shippedAt", "deliveredAt" }`.

### Statuses

| Contract | Store order status | Meaning |
| --- | --- | --- |
| `REQUESTED` | `pending` | Received; operations confirm stock and price with the supplier. |
| `CONFIRMED` | `confirmed` | Operations confirmed it; being procured. |
| `SHIPPED` | `shipped` | Handed to the carrier (`shipment`). |
| `COMPLETED` | `delivered` | Delivered. |
| `CANCELLED` | `cancelled` | Cancelled; `cancelledBy` is `GETIRBAKIM` (operations) or `PARTNER`. |

Changes from 1.0: `RESERVATION_EXPIRED` is gone (nothing is reserved and
nothing expires); `REJECTED` is not emitted, an order operations refuse is
`CANCELLED` with `cancelledBy: "GETIRBAKIM"`. Partner cancellation (`DELETE`)
comes in a later version.

## Errors

`{ "error": { "code", "message", "details"? } }`

| Status | Code | When | details |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Bad body, missing or non-UUID `Idempotency-Key` | `issues: [{ path, message }]` |
| 401 | `UNAUTHORIZED` | Missing or wrong key | |
| 404 | `ORDER_NOT_FOUND` | Not this partner's order | |
| 409 | `OFFER_UNAVAILABLE` | Unknown offer, not sold now, or the supplier no longer has it | `selectedOfferIds` |
| 409 | `PRICE_CHANGED` | A line's price moved since the quote | `lines: [{ selectedOfferId, expectedUnitNetKurus, unitNetKurus }]`; `unitNetKurus` is the new price, or `null` while the supplier's new cost is still being saved |
| 409 | `QUOTE_EXPIRED` | The quote is older than 15 minutes | `expiredAt` |
| 409 | `QUOTE_CHANGED` | Token not signed by us, for another partner, or lines differ; checkout rules changed | |
| 409 | `CREDIT_LIMIT_EXCEEDED` | Open orders + this order exceed the limit | `limitKurus, openKurus, orderKurus` |
| 409 | `IDEMPOTENCY_CONFLICT` | Key reused with another body | |
| 429 | `RATE_LIMITED` | Too many requests | |
| 503 | `QUOTE_CONFIGURATION_UNAVAILABLE` | `PARTNER_QUOTE_SIGNING_SECRET` missing (< 32 chars) | |
| 503 | `ORDER_LIMIT_UNAVAILABLE` | `PARTNER_ORDER_LIMIT_KURUS` missing | |
| 503 | `SUPPLIER_CHECK_UNAVAILABLE` | The live check failed on our side; retry with the same key | |
| 500 | `INTERNAL_ERROR` | Unexpected | |

On every 409 except `IDEMPOTENCY_CONFLICT` the partner requests a new quote and
orders with a new `Idempotency-Key`.

## Storage

A partner order is a `commerce_orders` row (`owner_kind='partner'`,
`owner_id=<partner code>`, `request_key` = Idempotency-Key,
`partner_fingerprint` = SHA-256 of the validated body,
`payment_status='on_account'`, `status='pending'`, no `payment_due_at`) with
`commerce_order_items` lines (`unit_price_kurus` = unit gross,
`reserved_quantity` 0, `pricing_snapshot.partner` = binding unit net/VAT).
Operations handle it in `/yonetim/siparisler` like a paid order; the TAMI payment
window and its expiry never touch it. Invoice columns stay empty (the partner
is invoiced) and no consumer pre-contract documents are stored.

## Configuration

- `PARTNER_API_KEYS`: `code:key` pairs (see `.env.example`).
- `PARTNER_QUOTE_SIGNING_SECRET`: at least 32 characters; rotating it voids open quotes.
- `PARTNER_ORDER_LIMIT_KURUS`: open-order limit per partner, VAT included.
- `PARTNER_B2B_DISCOUNT_BPS`: optional discount, as for the products endpoint.
