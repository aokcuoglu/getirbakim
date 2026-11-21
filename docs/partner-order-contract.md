# Partner order contract (v2.0)

Partner orders (#426) let a partner (BakımX) order parts found through
`GET /api/partner/v1/products` for delivery to a workshop. Version 2.0 replaces
the 1.0 pilot (single line, reservation TTL, `RESERVATION_EXPIRED`); it is not
backwards compatible.

All endpoints live under `/api/partner/v1`, take `Authorization: Bearer <key>`
(`PARTNER_API_KEYS`) and answer JSON with `Cache-Control: no-store`. A
request with a valid key is limited per partner key only, whatever address it
comes from: the order endpoints share 300 requests per minute (products: 600).
A partner calling from its own servers therefore shares no budget between its
workshops' addresses (#1093). Requests with a missing or wrong key are counted
per client address (order endpoints: 60 per minute, products: 120); an address
over that budget is refused before its key is checked. Over a limit the answer
is `429 RATE_LIMITED` with `Retry-After`. The address is the one our edge
reports (CloudFront's viewer address, else the last `X-Forwarded-For` hop),
never `X-Real-IP`. Counters are kept per application task, so with several
tasks the effective limit is the per-task limit times the task count. The partner identity comes only from the key: request bodies
are strict and refuse unknown fields, including any partner field.

Amounts are integer kuruş in TRY. `*NetKurus` excludes VAT, `*VatKurus` is the
VAT, `*GrossKurus` = net + VAT. `unitNetKurus` is the binding unit price. VAT
is computed once per line, like an e-invoice line:
`lineNetKurus = unitNetKurus × quantity`,
`lineVatKurus = round(lineNetKurus × vatRateBps / 10000)` (half up),
`lineGrossKurus = lineNetKurus + lineVatKurus`. Order totals are sums of the
lines: `netKurus`, `vatKurus`, then `grossKurus` = goods gross + `shippingKurus`.
Example: 1001 × 99 at 20% is 99099 net, 19820 VAT, 118919 gross.

`shippingKurus` is VAT-inclusive (the store fee as charged); `netKurus` and
`vatKurus` cover the goods only, so `grossKurus = netKurus + vatKurus + shippingKurus`.

**Shipping** uses the storefront's rule: the store shipping fee (VAT
included) unless the goods gross total reaches the free-shipping threshold
(or the fee is 0). It is part of the quote, bound by its token, re-checked at
order time like the prices, stored on the order and counted in the limit.

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
5. To cancel, `DELETE /orders/:id` (see below).

## POST /order-quotes

```json
{ "lines": [ { "selectedOfferId": "offer_0000a569053e4b84a484d510f04fab3b", "quantity": 2 } ] }
```

1–20 lines, each offer once, quantity 1–99. Answer `200`:

```json
{ "quote": {
  "contractVersion": "2.0",
  "lines": [ { "selectedOfferId": "offer_…", "quantity": 2, "unitNetKurus": 13000, "vatRateBps": 2000,
               "lineNetKurus": 26000, "lineVatKurus": 5200, "lineGrossKurus": 31200 } ],
  "totals": { "netKurus": 26000, "vatKurus": 5200, "shippingKurus": 5000, "grossKurus": 36200 },
  "currency": "TRY",
  "expiresAt": "2026-11-18T10:15:00.000Z",
  "confirmationToken": "<opaque>"
} }
```

The unit price is the partner's B2B price before VAT (the partner's discount
applied, never below cost), from the storefront's current saved price. Only
supplier offers the storefront sells right now can be quoted. The discount is
the partner's `/yonetim/partnerler` value, else `PARTNER_B2B_DISCOUNT_BPS`, else
none, read fresh for every quote and again inside the order transaction. The
token binds the unit prices, so a discount changed between quote and order is
refused with `PRICE_CHANGED` (the new unit price in `details.lines`); the
partner requests a new quote.

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
- `phone` must be a Turkish number (landline or mobile, with or without
  `0`/`+90`); it is stored as `+90XXXXXXXXXX`.
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

At order time the server, in this order: replays a known key; refuses a
partner whose order intake is paused; refuses when ordering is not configured; verifies the token (partner, lines, expiry); checks
the suppliers live (the storefront's checkout rule, `supplier-checkout-policy`:
Başbuğ, SETA and Dinamik are asked for these codes when the live mode is on; a
supplier that does not answer leaves the line on its fresh saved data, marked
for operations); then, under a per-partner lock, re-prices every line, checks
the open-order limit and creates the order.

**Payment is on account.** No payment is taken; GetirBakım invoices the partner
later.

**Open-order limit.** The partner's outstanding amount is the gross total
(VAT and shipping included) of its orders that are neither cancelled nor
delivered, plus its delivered orders GetirBakım has not invoiced yet. The
outstanding amount plus the new order must not exceed the partner's limit;
a delivered order stops counting once operations mark it invoiced. Returned
items do not reduce it: a delivered order stays in the outstanding amount
(`openKurus` in `CREDIT_LIMIT_EXCEEDED`) with its full total until it is
invoiced. If operations undo a wrong invoiced mark, those orders count again;
orders already accepted are not affected, but a new order may then be refused
with `CREDIT_LIMIT_EXCEEDED`. Correcting an invoice's number or date does not
change the outstanding amount. The limit
is the one set for the partner in the GetirBakım admin, else the deployment
default `PARTNER_ORDER_LIMIT_KURUS`. Orders of one partner are created one at
a time, so two concurrent orders cannot both pass a limit they exceed
together. A partner with no limit cannot order
(`503 ORDER_LIMIT_UNAVAILABLE`).

**Paused order intake.** GetirBakım can pause a partner's order intake from
its admin. While paused, `POST /order-quotes` and new `POST /orders` are
refused with `503 ORDER_INTAKE_PAUSED` (no `details`, no `Retry-After`). On
`POST /order-quotes` body validation (`400 VALIDATION_ERROR`) and
`QUOTE_CONFIGURATION_UNAVAILABLE` come first; on `POST /orders` the pause is
checked after the replay of a known key and before the limit, the quote or a
supplier check, and again when the order is created. `GET /products`,
`GET /orders/:id`, `GET /orders/by-key/:key` and `DELETE /orders/:id` keep
working, and repeating an order created before the pause with the same
`Idempotency-Key` and body still answers `200` with that order. A key that did
not create an order is not replayed: retrying it while paused, including a
request that was in flight when the pause landed, gets `503` again. Quotes
issued before a pause keep their 15-minute expiry, so after a longer pause the
partner requests a new quote (`409 QUOTE_EXPIRED` otherwise). Do not retry
automatically; ordering resumes once GetirBakım reopens intake.

## GET /orders/:id and GET /orders/by-key/:key

`200 { "order": <Order> }`. Only the calling partner's orders are visible;
anything else, including a malformed id or key, is `404 ORDER_NOT_FOUND`.
`by-key` lets a client whose create call timed out find out whether the order
exists before retrying.

## DELETE /orders/:id

Cancels one of the calling partner's orders, or asks operations to:

| Order status | Answer | Effect |
| --- | --- | --- |
| `REQUESTED` | `200 { "order", "cancellation": "CANCELLED" }` | Cancelled at once; `cancelledBy: "PARTNER"`. |
| `CONFIRMED` | `202 { "order", "cancellation": "REQUESTED" }` | A cancel request is recorded (`cancellationRequest.status: "PENDING"`); the order is not shipped until operations decide it. |
| `CONFIRMED`, request rejected | `409 CANCELLATION_REJECTED` | Final: the order ships; a return goes through operations. |
| `SHIPPED`, `COMPLETED` | `409 ORDER_ALREADY_SHIPPED` | Returns are arranged with operations. |
| `CANCELLED` | `200 { "order", "cancellation": "CANCELLED" }` | Nothing changes. |

`DELETE` is repeatable: a repeated call answers the same and keeps the first
request time. Another partner's order, or a malformed id, is
`404 ORDER_NOT_FOUND`. There is no request body. After a `202`, follow the
decision with `GET /orders/:id`: approved, the order becomes `CANCELLED` with
`cancelledBy: "PARTNER"`; rejected, `cancellationRequest.status` becomes
`REJECTED` and the order continues to `SHIPPED`.

## Order

```json
{
  "contractVersion": "2.0",
  "id": "uuid", "number": 1042, "idempotencyKey": "uuid",
  "status": "REQUESTED",
  "paymentStatus": "ON_ACCOUNT",
  "currency": "TRY",
  "totals": { "netKurus": 26000, "vatKurus": 5200, "shippingKurus": 5000, "grossKurus": 36200 },
  "lines": [ { "selectedOfferId": "offer_…", "partNo": "LUK 510 0207 10", "name": "…", "quantity": 2,
               "unitNetKurus": 13000, "vatRateBps": 2000, "lineNetKurus": 26000, "lineVatKurus": 5200, "lineGrossKurus": 31200 } ],
  "shippingAddress": { "recipientName": "…", "phone": "…", "email": null, "province": "İstanbul", "district": "Kadıköy", "addressLine": "…", "postalCode": null },
  "note": "",
  "shipment": null,
  "cancelledBy": null, "cancelledAt": null,
  "cancellationRequest": null,
  "createdAt": "2026-11-18T10:01:00.000Z"
}
```

`shipment` is set once the order ships:
`{ "carrier", "trackingNo", "trackingUrl", "shippedAt", "deliveredAt" }`.

`cancellationRequest` is `null` unless the partner asked to cancel a confirmed
order: `{ "status", "requestedAt", "decidedAt" }`, `status` one of `PENDING`
(operations have not decided; `decidedAt: null`), `APPROVED` (the order was
cancelled; `decidedAt` = `cancelledAt`) or `REJECTED` (final; `decidedAt` =
the rejection time). If operations cancel such an order themselves,
`cancelledBy` is `GETIRBAKIM` and the request reads `APPROVED`.

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
`CANCELLED` with `cancelledBy: "GETIRBAKIM"`. A partner's own cancellation
(`DELETE`, or an approved cancel request) is `cancelledBy: "PARTNER"`.

## Errors

`{ "error": { "code", "message", "details"? } }`

| Status | Code | When | details |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Bad body, missing or non-UUID `Idempotency-Key` | `issues: [{ path, message }]` |
| 401 | `UNAUTHORIZED` | Missing or wrong key | |
| 404 | `ORDER_NOT_FOUND` | Not this partner's order | |
| 409 | `OFFER_UNAVAILABLE` | Unknown offer, not sold now, or the supplier no longer has it | `selectedOfferIds` |
| 409 | `QUANTITY_UNAVAILABLE` | A line asks for more than can be ordered per line | `lines: [{ selectedOfferId, requestedQuantity }]`; the orderable quantity is not disclosed (stock counts are not shared) |
| 409 | `PRICE_CHANGED` | A line's price or the shipping fee moved since the quote | `lines: [{ selectedOfferId, expectedUnitNetKurus, unitNetKurus }]`; `unitNetKurus` is the new price, or `null` while the supplier's new cost is still being saved; `shipping: { expectedShippingKurus, shippingKurus }` when the fee changed |
| 409 | `QUOTE_EXPIRED` | The quote is older than 15 minutes | `expiredAt` |
| 409 | `QUOTE_CHANGED` | Token not signed by us, for another partner, or lines differ; checkout rules changed | |
| 409 | `CREDIT_LIMIT_EXCEEDED` | Outstanding amount (open + delivered, uninvoiced orders) + this order exceed the limit | `limitKurus, openKurus` (outstanding amount), `orderKurus` |
| 409 | `IDEMPOTENCY_CONFLICT` | Key reused with another body | |
| 409 | `CANCELLATION_REJECTED` | `DELETE` on a confirmed order whose cancel request operations rejected | |
| 409 | `ORDER_ALREADY_SHIPPED` | `DELETE` on a shipped or delivered order | |
| 429 | `RATE_LIMITED` | Too many requests | |
| 503 | `QUOTE_CONFIGURATION_UNAVAILABLE` | `PARTNER_QUOTE_SIGNING_SECRET` missing (< 32 chars) | |
| 503 | `ORDER_LIMIT_UNAVAILABLE` | No limit for the partner (admin value or `PARTNER_ORDER_LIMIT_KURUS`) | |
| 503 | `ORDER_INTAKE_PAUSED` | GetirBakım paused new quotes and orders for this partner; reads and cancels keep working. Do not retry automatically | |
| 503 | `SUPPLIER_CHECK_UNAVAILABLE` | The live check failed on our side; retry with the same key | |
| 500 | `INTERNAL_ERROR` | Unexpected | |

On every order-creation 409 except `IDEMPOTENCY_CONFLICT` the partner requests
a new quote and orders with a new `Idempotency-Key`. The `DELETE` 409s are final
for that order.

## Storage

A partner order is a `commerce_orders` row (`owner_kind='partner'`,
`owner_id=<partner code>`, `request_key` = Idempotency-Key,
`partner_fingerprint` = SHA-256 of the validated body,
`payment_status='on_account'`, `status='pending'`, no `payment_due_at`,
`subtotal_kurus` = goods gross, `shipping_kurus`, `total_kurus` = both) with
`commerce_order_items` lines (`unit_price_kurus` = line gross ÷ quantity,
rounded, for the store's screens; `reserved_quantity` 0;
`pricing_snapshot.partner` = binding unit net, VAT rate and the line's net, VAT
and gross). `email` is stored as an empty string when none is sent (the column
is NOT NULL for store orders).
A partner cancel is stored as `cancelled_by='customer'` (the owner kind tells
partner from store customer); a cancel request as `cancel_requested_at` and,
when rejected, `cancel_request_rejected_at`. While a request is open (requested,
not rejected) the order cannot be shipped by hand or with a Geliver label.
Operations handle it in `/yonetim/siparisler` like a paid order; the TAMI payment
window and its expiry never touch it. Invoice columns stay empty (the partner
is invoiced) and no consumer pre-contract documents are stored.

## Configuration

- `PARTNER_API_KEYS`: `code:key` pairs (see `.env.example`).
- `PARTNER_QUOTE_SIGNING_SECRET`: at least 32 characters; rotating it voids open quotes.
- `PARTNER_ORDER_LIMIT_KURUS`: default open-order limit per partner in kuruş, VAT and shipping included; a limit set in
  `/yonetim/partnerler` overrides it.
- `PARTNER_B2B_DISCOUNT_BPS`: optional fallback discount in basis points for partners without a discount set in
  `/yonetim/partnerler` (see the products contract's Discount section).
