## Partner order contract

Catalog prices are informational. A partner must select the opaque
`offers[].selectedOfferId`, request `POST /api/partner/v1/order-quotes`, then send
the returned `unitNetKurus` as `expectedUnitNetKurus` and its opaque
`confirmationToken` to
`POST /api/partner/v1/orders` with an `Idempotency-Key` header.

The server derives partner identity only from the API key. Request bodies are
strict and do not accept a partner identity. The order response exposes only the
binding net, VAT, gross, currency, opaque policy version, and expiry; supplier
cost and commercial policy inputs are never returned.

Catalog calls use `PARTNER_API_KEYS`; binding quote and order calls use the
separate `PARTNER_ORDER_API_KEYS` partnerCode:key list. An unset order key list
rejects every order call, including reads and cancellations.
The two lists must use different secrets even for the same partner code; a
credential present in the catalog list is denied order authority.

The confirmation token is HMAC-signed with the deployment-owned
`PARTNER_QUOTE_SIGNING_SECRET` and binds the authenticated partner, offer,
quantity, unit binding price, policy version, supplier pricing/sync timestamps,
and quote expiry. Order creation atomically rejects an expired token or any
price-, policy-, or freshness-only mismatch with a reconfirmation conflict.

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
`GET /api/partner/v1/orders/by-key/:key` resolves an uncertain create by the
same idempotency key, under the same tenant and order credential. It returns
`{order}` or `ORDER_NOT_FOUND` (404), so the caller can reconcile after a
network failure without retaining the quote confirmation token.

Canonical status order is `REQUESTED`, `CONFIRMED`, `REJECTED`,
`RESERVATION_EXPIRED`, `CANCELLED`, `SHIPPED`, `COMPLETED`. Confirmation is an
internal fulfilment operation and succeeds only while the existing reservation
is still `ACTIVE`; confirmation changes it to durable `COMMITTED` inventory so
the quote TTL cannot make confirmed stock sellable again. An expired reservation
is never revived.

GetirBakım admins manage requests at `/admin/partner-orders`. Every decision
requires the displayed order version and records the authenticated operator,
time, transition, and reason in `partner_order_actions`. Rejection and accepted
cancellation release inventory atomically; confirmation commits a live hold.
A confirmed cancellation request must be accepted or declined before shipment.
Shipment and completion preserve the committed hold, since releasing it before
the supplier stock feed reflects fulfillment would make stock sellable twice.
The existing operations endpoint expires pending requests and retries webhook
outbox events; its delivery, expiry, and cancellation counts appear in the queue.
The queue gives live requests and cancellation decisions separate 100-row caps,
plus 20 overdue requests and 100 recent orders; the count cards reveal any
backlog beyond those visible rows.

`COMPLETED` orders deliberately retain `COMMITTED` holds. The supplier owns
physical stock, and an automatic release on shipment or completion could sell
the same unit twice while its stock feed still reports the pre-fulfillment
quantity. The queue reports completed committed holds. Before customer launch,
operations must agree on a supplier feed reconciliation contract that proves a
fulfilled unit has been reflected in refreshed supplier stock, then implement
an audited hold-release action against that proof. Until then, keep the pilot
in development and review growing holds; do not release them by ad-hoc SQL.

`PARTNER_ORDER_POLICY_JSON` is deployment-owned and required. Its shape is
documented in `.env.example`; this change intentionally supplies no production
or commercial values and performs no production activation.

Quotes do not reserve capacity. Their expiry is the binding price/freshness
window; capacity is authoritative only at the atomic order-create boundary.
