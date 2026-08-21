## Partner order contract

Catalog prices are informational. A partner must select the opaque
`offers[].selectedOfferId`, request `POST /api/partner/v1/order-quotes`, then send
the returned `unitNetKurus` as `expectedUnitNetKurus` to
`POST /api/partner/v1/orders` with an `Idempotency-Key` header.

The server derives partner identity only from the API key. Request bodies are
strict and do not accept a partner identity. The order response exposes only the
binding net, VAT, gross, currency, opaque policy version, and expiry; supplier
cost and commercial policy inputs are never returned.

Creation locks and revalidates the selected active offer, its currency, cost,
freshness, and available stock. It then creates the `REQUESTED` order and its
`ACTIVE` reservation in one serializable transaction. Missing or invalid server
policy, untrusted stock, stale pricing, price movement, and insufficient stock
fail closed with typed errors. This flow never creates a consumer payment or
checkout record.

`GET /api/partner/v1/orders/:id` is tenant-scoped and lazily marks an expired
request `RESERVATION_EXPIRED`. `DELETE` cancels a `REQUESTED` order and releases
its reservation idempotently. After `CONFIRMED`, `DELETE` records a cancellation
request without directly changing order status.

Canonical status order is `REQUESTED`, `CONFIRMED`, `REJECTED`,
`RESERVATION_EXPIRED`, `CANCELLED`, `SHIPPED`, `COMPLETED`. Confirmation is an
internal fulfilment operation and succeeds only while the existing reservation
is still `ACTIVE`; confirmation changes it to durable `COMMITTED` inventory so
the quote TTL cannot make confirmed stock sellable again. An expired reservation
is never revived.

`PARTNER_ORDER_POLICY_JSON` is deployment-owned and required. Its shape is
documented in `.env.example`; this change intentionally supplies no production
or commercial values and performs no production activation.

Quotes do not reserve capacity. Their expiry is the binding price/freshness
window; capacity is authoritative only at the atomic order-create boundary.
