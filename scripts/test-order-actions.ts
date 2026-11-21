import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { isolatedSchema } from "./isolated-schema";
import { orderListBack, orderListReturn } from "../src/modules/admin/order-list-return";
import { lineFigures, liveCheckReasonLabel, needsProcurement, orderLineView, procurementOpenSql, procurementSummary, supplierItemHref } from "../src/modules/admin/order-procurement";
import { returnRefusal, returnRoom } from "../src/modules/store/returns";
import { carrierCodes, defaultCarrier, resolveTrackingUrl, shipmentSchema, startingCarrier, yurticiTrackingRule } from "../src/modules/store/shipment";

// Admin order steps (#516) in an isolated copy of the schema; nothing touches the shared database's tables.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let orders: typeof import("../src/modules/admin/orders");
let services: typeof import("../src/modules/admin/service-accounts");
let payments: typeof import("../src/modules/payments/checkout");
let closeDb: () => Promise<void>;
let product = "", spare = "";

type Line = { quantity: number; reserved: number | null; product?: "spare" | "supplier"; snapshot?: Record<string, unknown> };
async function order(status: string, payment: string, lines: Line[], { note = "", due = null as string | null } = {}) {
  const id = (await schema.pool.query<{ id: string }>(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,customer_name,email,phone,address,
    total_kurus,subtotal_kurus,discount_percent,status,payment_status,payment_note,payment_due_at)
    VALUES('guest',$1,$2,'Test','t@example.invalid','5551234567','Test address',10000,10000,0,$3,$4,$5,$6::timestamptz) RETURNING id::text`,
  [randomUUID(), randomUUID(), status, payment, note, due])).rows[0].id;
  for (const line of lines) {
    await schema.pool.query(`INSERT INTO commerce_order_items(order_id,product_id,code,name,supplier,quantity,unit_price_kurus,pricing_snapshot,reserved_quantity)
      VALUES($1,$2,'X','Line','demo',$3,1000,$5,$4)`, [id, line.product === "supplier" ? randomUUID() : line.product === "spare" ? spare : product, line.quantity, line.reserved,
      JSON.stringify(line.snapshot ?? {})]);
  }
  return id;
}
const stock = async (id = product) => (await schema.pool.query<{ stock: number }>("SELECT stock FROM store_products WHERE id=$1", [id])).rows[0].stock;
const setStock = (value: number) => schema.pool.query("UPDATE store_products SET stock=$2 WHERE id=$1", [product, value]);
const row = async (id: string) => (await schema.pool.query("SELECT * FROM commerce_orders WHERE id=$1", [id])).rows[0];
const reserved = async (id: string) => (await schema.pool.query<{ reserved_quantity: number | null }>(
  "SELECT reserved_quantity FROM commerce_order_items WHERE order_id=$1 ORDER BY quantity", [id])).rows.map(r => r.reserved_quantity);

before(async () => {
  schema = await isolatedSchema("order_actions_test");
  [product, spare] = (await schema.pool.query<{ id: string }>(`INSERT INTO store_products(supplier,code,name,brand,price_kurus,stock)
    VALUES('demo','ORD-1','Order part','TEST',1000,10),('demo','ORD-2','Spare part','TEST',1000,0) RETURNING id::text`)).rows.map(r => r.id);
  const [{ db }, adminOrders, accounts, checkout] = await Promise.all([import("../src/lib/db"), import("../src/modules/admin/orders"),
    import("../src/modules/admin/service-accounts"), import("../src/modules/payments/checkout")]);
  orders = adminOrders; services = accounts; payments = checkout;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("actions return to the list they came from; anything else falls back to the plain list", () => {
  assert.equal(orderListReturn("/yonetim/siparisler?status=action&sort=total&dir=desc&page=3", "saved"),
    "/yonetim/siparisler?status=action&sort=total&dir=desc&page=3&saved=1");
  assert.equal(orderListReturn("/yonetim/siparisler", "error"), "/yonetim/siparisler?error=1");
  // The Müşteri column's owner filter (#426) is kept too.
  assert.equal(orderListReturn("/yonetim/siparisler?status=cancel_request&sahip=partner", "saved"), "/yonetim/siparisler?status=cancel_request&sahip=partner&saved=1");
  // TAMI refund outcomes (#619) replace any earlier outcome.
  for (const outcome of ["refunded", "refund_failed", "refund_void_failed", "refund_unknown", "refund_busy", "refund_unavailable"] as const) {
    assert.equal(orderListReturn("/yonetim/siparisler?status=refund&saved=1", outcome), `/yonetim/siparisler?status=refund&${outcome}=1`);
  }
  assert.equal(orderListReturn("/yonetim/siparisler?refund_unknown=1&page=2", "refunded"), "/yonetim/siparisler?page=2&refunded=1");
  // Geliver label outcomes (#960) behave the same way.
  // An orphaned label names its order: the number is the outcome's value (digits only).
  assert.equal(orderListReturn("/yonetim/siparisler?status=shipping", "label_orphan", "1042"), "/yonetim/siparisler?status=shipping&label_orphan=1042");
  assert.equal(orderListReturn("/yonetim/siparisler", "label_orphan", "1042&x=y"), "/yonetim/siparisler?label_orphan=1");
  // The per-order invoice undo (#1038) names the order too.
  assert.equal(orderListReturn("/yonetim/siparisler?status=delivered&sahip=partner&invoice_undone=9", "invoice_undone", "123"), "/yonetim/siparisler?status=delivered&sahip=partner&invoice_undone=123");
  for (const outcome of ["label_created", "label_unknown", "label_failed", "label_busy", "label_orphan", "label_held"] as const) {
    assert.equal(orderListReturn("/yonetim/siparisler?status=shipping&label_unknown=1&page=2", outcome), `/yonetim/siparisler?status=shipping&page=2&${outcome}=1`);
  }
  // Order email resend outcomes (#1035).
  for (const outcome of ["email_sent", "email_skipped", "email_pending", "email_busy"] as const) {
    assert.equal(orderListReturn("/yonetim/siparisler?status=action&saved=1&page=2", outcome, "1042"), `/yonetim/siparisler?status=action&page=2&${outcome}=1042`);
  }
  // A stale outcome and unknown parameters are dropped.
  assert.equal(orderListReturn("/yonetim/siparisler?status=refund&error=1&x=y", "saved"), "/yonetim/siparisler?status=refund&saved=1");
  for (const value of ["//evil.example/yonetim/siparisler", "https://evil.example/yonetim/siparisler", "/yonetim/siparislerX", "/yonetim/urunler?status=action",
    "javascript:alert(1)", "/\\evil.example", "", null, undefined, ["/yonetim/siparisler"]]) {
    assert.equal(orderListReturn(value, "saved"), "/yonetim/siparisler?saved=1", String(value));
  }
  // The procurement filter (#606) is kept too.
  assert.equal(orderListReturn("/yonetim/siparisler?status=action&tedarik=open&page=2", "saved"), "/yonetim/siparisler?status=action&tedarik=open&page=2&saved=1");
  assert.equal(orderListBack.safeParse("//evil.example").success, false);
  assert.equal(orderListBack.safeParse("/yonetim/siparisler?page=2").success, true);
});

const shipment = (input: Record<string, string>) => shipmentSchema.parse(input);

test("order steps follow the state machine and only for paid or legacy offline orders", async () => {
  const paid = await order("pending", "paid", [{ quantity: 1, reserved: 1 }]);
  const yurtici = shipment({ carrier: "yurtici", trackingNo: "1234 5678 9012" });
  assert.equal(await orders.shipOrder(paid, yurtici), false);
  assert.equal(await orders.transitionOrder(paid, "confirmed"), true);
  assert.equal((await row(paid)).status, "confirmed");
  assert.equal(await orders.transitionOrder(paid, "confirmed"), false);
  // Delivery needs a shipment first.
  assert.equal(await orders.transitionOrder(paid, "delivered"), false);
  assert.equal(await orders.shipOrder(paid, yurtici), true);
  const shipped = await row(paid);
  assert.equal(shipped.status, "shipped"); assert.equal(shipped.carrier, "yurtici"); assert.equal(shipped.carrier_name, null);
  assert.equal(shipped.tracking_no, "123456789012");
  assert.equal(shipped.tracking_url, "https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=123456789012");
  assert.ok(shipped.shipped_at instanceof Date); assert.equal(shipped.delivered_at, null);
  assert.equal(await orders.shipOrder(paid, yurtici), false);
  assert.equal(await orders.transitionOrder(paid, "cancelled"), false);
  assert.equal(await orders.transitionOrder(paid, "delivered"), true);
  const delivered = await row(paid);
  assert.equal(delivered.status, "delivered"); assert.ok(delivered.delivered_at instanceof Date);
  // delivered is final.
  for (const status of ["confirmed", "cancelled", "delivered"] as const) assert.equal(await orders.transitionOrder(paid, status), false);
  assert.equal(await orders.shipOrder(paid, yurtici), false);
  assert.equal((await row(paid)).status, "delivered");
  // An unpaid online order is left to expiry.
  const unpaid = await order("awaiting_payment", "awaiting", [{ quantity: 1, reserved: 1 }]);
  assert.equal(await orders.transitionOrder(unpaid, "confirmed"), false);
  assert.equal(await orders.transitionOrder(unpaid, "cancelled"), false);
  assert.equal(await orders.shipOrder(unpaid, yurtici), false);
  assert.equal(await orders.shipOrder(await order("confirmed", "awaiting", [{ quantity: 1, reserved: 1 }]), yurtici), false);
  assert.equal((await row(unpaid)).status, "awaiting_payment");
  const offline = await order("pending", "none", [{ quantity: 1, reserved: 0 }]);
  assert.equal(await orders.transitionOrder(offline, "confirmed"), true);
  assert.equal(await orders.transitionOrder(randomUUID(), "confirmed"), false);
});

test("shipment details can be corrected only while the order is shipped; the ship time stays", async () => {
  const id = await order("confirmed", "paid", [{ quantity: 1, reserved: 0, product: "supplier" }]);
  const other = shipment({ carrier: "other", carrierName: "Yerel Kurye", trackingNo: "KRY-1" });
  assert.equal(await orders.updateShipment(id, other), false);
  assert.equal(await orders.shipOrder(id, shipment({ carrier: "mng", trackingNo: "WRONG1" })), true);
  const before = await row(id);
  assert.equal(before.tracking_url, null);
  assert.equal(await orders.updateShipment(id, other), true);
  const after = await row(id);
  assert.equal(after.status, "shipped"); assert.equal(after.carrier, "other"); assert.equal(after.carrier_name, "Yerel Kurye");
  assert.equal(after.tracking_no, "KRY-1"); assert.equal(after.tracking_url, null);
  assert.equal(after.shipped_at.getTime(), before.shipped_at.getTime());
  // A hand-entered link wins over the template.
  assert.equal(await orders.updateShipment(id, shipment({ carrier: "ups", trackingNo: "1Z999", trackingUrl: "https://example.com/t/1Z999" })), true);
  assert.equal((await row(id)).tracking_url, "https://example.com/t/1Z999");
  assert.equal(await orders.transitionOrder(id, "delivered"), true);
  assert.equal(await orders.updateShipment(id, other), false);
  assert.equal((await row(id)).carrier, "ups");
  // An order shipped before #605 has no carrier yet; it can be completed.
  const legacy = await order("shipped", "none", [{ quantity: 1, reserved: 0 }]);
  assert.equal(await orders.updateShipment(legacy, shipment({ carrier: "aras", trackingNo: "ARAS123" })), true);
  const completed = await row(legacy);
  assert.equal(completed.carrier, "aras"); assert.equal(completed.shipped_at, null);
  assert.equal(completed.tracking_url, "https://kargotakip.araskargo.com.tr/mainpage.aspx?code=ARAS123");
});

test("the shipment form rejects a missing or malformed tracking number, carrier or link", () => {
  const fails = (input: Record<string, string>) => shipmentSchema.safeParse(input).error?.flatten().fieldErrors ?? {};
  assert.ok(fails({ carrier: "ups", trackingNo: "" }).trackingNo);
  assert.ok(fails({ carrier: "ups", trackingNo: "   " }).trackingNo);
  assert.ok(fails({ carrier: "ups", trackingNo: "ABC" }).trackingNo);
  assert.ok(fails({ carrier: "ups" }).trackingNo);
  assert.ok(fails({ carrier: "ups", trackingNo: "A".repeat(41) }).trackingNo);
  assert.ok(fails({ carrier: "ups", trackingNo: "ABC_123" }).trackingNo);
  assert.ok(fails({ carrier: "ups", trackingNo: "<script>" }).trackingNo);
  assert.equal(shipment({ carrier: "aras", trackingNo: " 12 34\t56 " }).trackingNo, "123456");
  assert.ok(fails({ carrier: "dhl-express", trackingNo: "ABCD1" }).carrier);
  assert.ok(fails({ trackingNo: "ABCD1" }).carrier);
  assert.ok(fails({ carrier: "other", trackingNo: "ABCD1" }).carrierName);
  assert.ok(fails({ carrier: "other", carrierName: " X ", trackingNo: "ABCD1" }).carrierName);
  assert.equal(shipment({ carrier: "other", carrierName: " Yerel Kurye ", trackingNo: "ABCD1" }).carrierName, "Yerel Kurye");
  // The free name is only kept for "other".
  assert.equal(shipment({ carrier: "ups", carrierName: "Başka", trackingNo: "ABCD1" }).carrierName, null);
  for (const trackingUrl of ["http://example.com/t", "javascript:alert(1)", "data:text/html,x", "example.com/t", "https://", `https://example.com/${"a".repeat(500)}`]) {
    assert.ok(fails({ carrier: "ups", trackingNo: "ABCD1", trackingUrl }).trackingUrl, trackingUrl);
  }
  assert.equal(shipment({ carrier: "ups", trackingNo: "ABCD1", trackingUrl: "" }).trackingUrl, null);
});

test("Yurtiçi tracking numbers are 12 or 16 digits; other carriers keep the general rule", () => {
  const trackingError = (carrier: string, trackingNo: string) => shipmentSchema.safeParse({ carrier, trackingNo }).error?.flatten().fieldErrors.trackingNo?.[0];
  assert.equal(trackingError("yurtici", "12345678901"), yurticiTrackingRule);
  assert.equal(trackingError("yurtici", "123456789012"), undefined);
  assert.equal(trackingError("yurtici", "1234 5678 9012 3456"), undefined);
  assert.equal(trackingError("yurtici", "1234567890123"), yurticiTrackingRule);
  assert.equal(trackingError("yurtici", "12345678901A"), yurticiTrackingRule);
  assert.equal(trackingError("yurtici", "1234-5678-9012"), yurticiTrackingRule);
  assert.equal(shipment({ carrier: "yurtici", trackingNo: " 1234 5678 9012 " }).trackingNo, "123456789012");
  assert.equal(trackingError("aras", "12345678901"), undefined);
  assert.equal(trackingError("ups", "1Z999AA1"), undefined);
});

test("Yurtiçi Kargo is the default carrier and leads the list; a recorded carrier is kept", () => {
  assert.equal(defaultCarrier, "yurtici");
  assert.equal(carrierCodes[0], "yurtici");
  assert.equal(startingCarrier(undefined), "yurtici");
  assert.equal(startingCarrier(null), "yurtici");
  assert.equal(startingCarrier("aras"), "aras");
  assert.equal(shipmentSchema.parse({ carrier: defaultCarrier, trackingNo: "123456789012" }).carrier, "yurtici");
});

test("tracking links: the admin's link, else the carrier template with the number encoded, else none", () => {
  assert.equal(resolveTrackingUrl("yurtici", "A B/1", null), "https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=A%20B%2F1");
  assert.equal(resolveTrackingUrl("ups", "1Z9", null), "https://www.ups.com/track?loc=tr_TR&tracknum=1Z9");
  for (const carrier of ["mng", "ptt", "surat", "hepsijet", "kolaygelsin", "other", "unknown"]) assert.equal(resolveTrackingUrl(carrier, "ABCD1", null), null, carrier);
  assert.equal(resolveTrackingUrl("mng", "ABCD1", "https://example.com/x"), "https://example.com/x");
  assert.equal(resolveTrackingUrl("yurtici", "ABCD1", "https://example.com/x"), "https://example.com/x");
});

test("returns are recorded on shipped and delivered orders only, up to the ordered quantity", async () => {
  const admin = (await schema.pool.query<{ id: string }>("INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Yönetici',$1,'x','admin',true) RETURNING id::text",
    [`${randomUUID()}@example.invalid`])).rows[0].id;
  const line = (orderId: string, quantity: number) => ({ orderId, productId: product, quantity, reason: "not_fit", note: "", adminId: admin });
  const returned = async (id: string) => Number((await schema.pool.query("SELECT COALESCE(sum(quantity),0) AS n FROM commerce_returns WHERE order_id=$1", [id])).rows[0].n);
  const confirmed = await order("confirmed", "paid", [{ quantity: 2, reserved: 0 }]);
  assert.equal(await orders.recordOrderReturn(line(confirmed, 1)), "unavailable");
  const shipped = await order("shipped", "paid", [{ quantity: 2, reserved: 0 }]);
  assert.equal(await orders.recordOrderReturn(line(shipped, 1)), "recorded");
  assert.equal(await orders.recordOrderReturn(line(shipped, 2)), "exceeded");
  assert.equal(await orders.recordOrderReturn(line(shipped, 1)), "recorded");
  assert.equal(await orders.recordOrderReturn(line(shipped, 1)), "exceeded");
  assert.equal(await returned(shipped), 2);
  const delivered = await order("delivered", "paid", [{ quantity: 3, reserved: 0 }]);
  assert.equal(await orders.recordOrderReturn(line(delivered, 3)), "recorded");
  assert.equal(await orders.recordOrderReturn(line(delivered, 1)), "exceeded");
  assert.equal(await returned(delivered), 3); assert.equal(await returned(confirmed), 0);
  // Concurrent returns of the same one-unit line: only one fits.
  const single = await order("delivered", "paid", [{ quantity: 1, reserved: 0 }]);
  const results = await Promise.all([1, 2, 3].map(() => orders.recordOrderReturn(line(single, 1))));
  assert.equal(results.filter(result => result === "recorded").length, 1);
  assert.deepEqual(results.filter(result => result !== "recorded"), ["exceeded", "exceeded"]);
  assert.equal(await returned(single), 1);
  // Deterministic: the calls queue behind a held line lock while another return commits; none may count without it.
  const held = await order("delivered", "paid", [{ quantity: 1, reserved: 0 }]);
  const blocker = await schema.pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT 1 FROM commerce_order_items WHERE order_id=$1 FOR UPDATE", [held]);
    const waiting = Promise.all([1, 2, 3].map(() => orders.recordOrderReturn(line(held, 1))));
    await sleep(300);
    await blocker.query("INSERT INTO commerce_returns(order_id,product_id,quantity,reason,note,created_by) VALUES($1,$2,1,'not_fit','',$3)", [held, product, admin]);
    await blocker.query("COMMIT");
    assert.deepEqual(await waiting, ["exceeded", "exceeded", "exceeded"]);
  } finally { blocker.release(); }
  assert.equal(await returned(held), 1);
  // A product that is not on the order.
  assert.equal(await orders.recordOrderReturn({ ...line(delivered, 1), productId: randomUUID() }), "unavailable");
});

test("return room and refusal: accepted returns and pending partner requests share the ordered quantity (#1151)", () => {
  assert.equal(returnRoom(3, 0, 0), 3);
  assert.equal(returnRoom(3, 1, 2), 0);
  assert.equal(returnRoom(3, 2, 2), 0);
  assert.equal(returnRefusal(3, 1, 0, 2), null);
  assert.equal(returnRefusal(3, 0, 2, 1), null);
  assert.equal(returnRefusal(3, 0, 2, 2), "pending");
  assert.equal(returnRefusal(3, 1, 2, 2), "pending");
  assert.equal(returnRefusal(3, 1, 2, 3), "exceeded");
  assert.equal(returnRefusal(3, 3, 0, 1), "exceeded");
});

test("the status check accepts delivered and nothing unknown, and survives a re-run of the schema", async () => {
  const id = await order("pending", "none", [{ quantity: 1, reserved: 0 }]);
  await schema.pool.query("UPDATE commerce_orders SET status='delivered' WHERE id=$1", [id]);
  await assert.rejects(schema.pool.query("UPDATE commerce_orders SET status='x' WHERE id=$1", [id]));
  const definition = async () => (await schema.pool.query<{ def: string }>(
    "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='commerce_orders'::regclass AND conname='commerce_orders_status_check'")).rows.map(r => r.def);
  const first = await definition();
  await schema.pool.query(await readFile("db/commerce.sql", "utf8"));
  await schema.pool.query(await readFile("db/commerce.sql", "utf8"));
  assert.deepEqual(await definition(), first);
  assert.match(first[0], /delivered/); assert.match(first[0], /awaiting_payment/);
  await assert.rejects(schema.pool.query("UPDATE commerce_orders SET status='x' WHERE id=$1", [id]));
  assert.equal((await row(id)).status, "delivered");
});

test("cancelling returns only the stock each line reserved, once; a refund is then recorded once", async () => {
  await setStock(10);
  // Two units taken; a late payment that found stock short for the second line; a supplier offer.
  const id = await order("confirmed", "paid", [{ quantity: 2, reserved: 2 }, { quantity: 3, reserved: 0, product: "spare" }, { quantity: 4, reserved: 0, product: "supplier" }]);
  assert.equal(await orders.transitionOrder(id, "cancelled"), true);
  assert.equal(await stock(), 12); assert.equal(await stock(spare), 0);
  assert.deepEqual(await reserved(id), [0, 0, 0]);
  const cancelled = await row(id);
  assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.payment_status, "refund_required");
  // Who cancelled and when (#607).
  assert.equal(cancelled.cancelled_by, "admin"); assert.ok(cancelled.cancelled_at instanceof Date);
  // A second cancel is refused and cannot restore again.
  assert.equal(await orders.transitionOrder(id, "cancelled"), false);
  assert.equal(await stock(), 12);

  assert.equal(await orders.recordOrderRefund(id, "TAMI-REF-1"), true);
  const refunded = await row(id);
  assert.equal(refunded.payment_status, "refunded"); assert.equal(refunded.refund_reference, "TAMI-REF-1");
  assert.ok(refunded.refunded_at instanceof Date);
  assert.equal(await orders.recordOrderRefund(id, "TAMI-REF-2"), false);
  assert.equal((await row(id)).refund_reference, "TAMI-REF-1");
  // No refund pending on an order that was never cancelled.
  assert.equal(await orders.recordOrderRefund(await order("pending", "paid", [{ quantity: 1, reserved: 1 }]), "TAMI-REF-3"), false);
});

test("a line written before the column (NULL) is returned in full, the old rule, and only once", async () => {
  await setStock(10);
  const id = await order("pending", "none", [{ quantity: 2, reserved: null }]);
  assert.equal(await orders.transitionOrder(id, "cancelled"), true);
  assert.equal(await stock(), 12);
  assert.deepEqual(await reserved(id), [0]);
  assert.equal((await row(id)).payment_status, "none");
});

test("expiry returns only reserved stock and clears it", async () => {
  await setStock(10);
  const id = await order("awaiting_payment", "awaiting", [{ quantity: 2, reserved: 1 }, { quantity: 5, reserved: 0, product: "supplier" }],
    { due: new Date(Date.now() - 60_000).toISOString() });
  // No payment attempt exists, so no provider call is made: the order simply expires.
  await payments.reconcileOrderPayments(id);
  const expired = await row(id);
  assert.equal(expired.status, "cancelled"); assert.equal(expired.payment_status, "expired");
  assert.equal(expired.cancelled_by, "expiry");
  assert.equal(await stock(), 11);
  assert.deepEqual(await reserved(id), [0, 0]);
  await payments.reconcileOrderPayments(id);
  assert.equal(await stock(), 11);
});

test("the schema backfills existing lines from what the old code reserved", async () => {
  const open = await order("confirmed", "paid", [{ quantity: 2, reserved: null }, { quantity: 3, reserved: null, product: "supplier" }]);
  const cancelled = await order("cancelled", "refund_required", [{ quantity: 2, reserved: null }]);
  const expired = await order("cancelled", "expired", [{ quantity: 2, reserved: null }]);
  const short = await order("pending", "paid", [{ quantity: 2, reserved: null }],
    { note: "Ödeme süre dolduktan sonra alındı ve mağaza stoku yetersiz; stok/iade kararı verin." });
  const recorded = await order("pending", "paid", [{ quantity: 2, reserved: 1 }]);
  await schema.pool.query(await readFile("db/commerce.sql", "utf8"));
  assert.deepEqual(await reserved(open), [2, 0]);
  assert.deepEqual(await reserved(cancelled), [0]);
  assert.deepEqual(await reserved(expired), [0]);
  assert.deepEqual(await reserved(short), [0]);
  assert.deepEqual(await reserved(recorded), [1]);
  await assert.rejects(schema.pool.query("UPDATE commerce_order_items SET reserved_quantity=quantity+1 WHERE order_id=$1", [recorded]));
});

test("approving a service account works once and only for waiting service accounts", async () => {
  const insert = async (role: string, approved: boolean) => (await schema.pool.query<{ id: string }>(
    "INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Servis',$1,'x',$2,$3) RETURNING id::text", [`${randomUUID()}@example.invalid`, role, approved])).rows[0].id;
  const waiting = await insert("service", false);
  assert.equal(await services.approveServiceAccount(waiting, 12), true);
  const account = (await schema.pool.query("SELECT approved,discount_percent FROM accounts WHERE id=$1", [waiting])).rows[0];
  assert.equal(account.approved, true); assert.equal(account.discount_percent, 12);
  assert.equal(await services.approveServiceAccount(waiting, 20), false);
  assert.equal((await schema.pool.query("SELECT discount_percent FROM accounts WHERE id=$1", [waiting])).rows[0].discount_percent, 12);
  assert.equal(await services.approveServiceAccount(await insert("admin", false), 5), false);
  assert.equal(await services.approveServiceAccount(randomUUID(), 5), false);
});

// Procurement of order lines (#606).
const supplierLine = (quantity = 1): Line => ({ quantity, reserved: 0, product: "supplier", snapshot: { source: "supplier", cost_kurus: 500, vat_percent: 20 } });
const storeLine: Line = { quantity: 1, reserved: 1, snapshot: { source: "store", base_price_kurus: 1000 } };
const lines = async (id: string) => (await schema.pool.query<{ product_id: string; procurement_status: string; procurement_ref: string | null;
  procurement_ordered_at: Date | null; procured_at: Date | null; procurement_by: string | null }>(
  "SELECT product_id::text,procurement_status,procurement_ref,procurement_ordered_at,procured_at,procurement_by::text FROM commerce_order_items WHERE order_id=$1 ORDER BY product_id", [id])).rows;
const adminAccount = async () => (await schema.pool.query<{ id: string }>(
  "INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Yönetici',$1,'x','admin',true) RETURNING id::text", [`${randomUUID()}@example.invalid`])).rows[0].id;

test("procurement moves freely while the order is pending or confirmed", async () => {
  const admin = await adminAccount();
  const id = await order("pending", "paid", [supplierLine()]);
  const [{ product_id: productId }] = await lines(id);
  const set = (status: "pending" | "ordered" | "procured", reference = "") => orders.setLineProcurement({ orderId: id, productId, status, reference, adminId: admin });
  assert.equal(await set("ordered", "  "), true);
  let [line] = await lines(id);
  assert.equal(line.procurement_status, "ordered"); assert.equal(line.procurement_ref, null); assert.ok(line.procurement_ordered_at); assert.equal(line.procured_at, null);
  assert.equal(line.procurement_by, admin);
  assert.equal(await set("ordered", "BSB-123"), true);
  const ordered = (await lines(id))[0];
  assert.equal(ordered.procurement_ref, "BSB-123");
  assert.equal(ordered.procurement_ordered_at?.getTime(), line.procurement_ordered_at?.getTime());
  await orders.transitionOrder(id, "confirmed");
  // The form sends the reference it shows: the same one keeps it; the order time stays.
  assert.equal(await set("procured", "BSB-123"), true);
  [line] = await lines(id);
  assert.equal(line.procurement_status, "procured"); assert.equal(line.procurement_ref, "BSB-123"); assert.ok(line.procured_at);
  assert.equal(line.procurement_ordered_at?.getTime(), ordered.procurement_ordered_at?.getTime());
  // A blank reference clears it.
  assert.equal(await set("procured", " "), true);
  assert.equal((await lines(id))[0].procurement_ref, null);
  // Back to ordered: no procured time, the order time stays.
  assert.equal(await set("ordered"), true);
  [line] = await lines(id);
  assert.equal(line.procured_at, null); assert.equal(line.procurement_ordered_at?.getTime(), ordered.procurement_ordered_at?.getTime());
  assert.equal(await set("pending"), true);
  [line] = await lines(id);
  assert.equal(line.procurement_status, "pending"); assert.equal(line.procurement_ref, null); assert.equal(line.procurement_ordered_at, null); assert.equal(line.procured_at, null);
  // Procured straight from pending: never ordered, so no order time.
  assert.equal(await set("procured", "Elden"), true);
  [line] = await lines(id);
  assert.equal(line.procurement_status, "procured"); assert.equal(line.procurement_ordered_at, null); assert.ok(line.procured_at); assert.equal(line.procurement_ref, "Elden");
  // Then ordered after all: the order time is set, the procured time cleared.
  assert.equal(await set("ordered", "Elden"), true);
  [line] = await lines(id);
  assert.ok(line.procurement_ordered_at); assert.equal(line.procured_at, null);
});

test("procurement is refused for store lines, unpaid, shipped, delivered and cancelled orders, and unknown lines", async () => {
  const admin = await adminAccount();
  const store = await order("pending", "paid", [storeLine]);
  const [storeRow] = await lines(store);
  assert.equal(await orders.setLineProcurement({ orderId: store, productId: storeRow.product_id, status: "ordered", reference: "x", adminId: admin }), false);
  assert.equal((await lines(store))[0].procurement_status, "pending");
  for (const [status, payment] of [["awaiting_payment", "awaiting"], ["pending", "expired"], ["shipped", "paid"], ["delivered", "paid"], ["cancelled", "refund_required"]]) {
    const id = await order(status, payment, [supplierLine()]);
    const [line] = await lines(id);
    assert.equal(await orders.setLineProcurement({ orderId: id, productId: line.product_id, status: "procured", reference: "x", adminId: admin }), false, `${status}/${payment}`);
    const after = (await lines(id))[0];
    assert.equal(after.procurement_status, "pending"); assert.equal(after.procurement_ref, null); assert.equal(after.procurement_by, null);
  }
  const open = await order("pending", "paid", [supplierLine()]);
  assert.equal(await orders.setLineProcurement({ orderId: open, productId: randomUUID(), status: "ordered", reference: "", adminId: admin }), false);
  assert.equal(await orders.setLineProcurement({ orderId: randomUUID(), productId: randomUUID(), status: "ordered", reference: "", adminId: admin }), false);
});

test("the procurement status check rejects unknown values and survives a re-run of the schema", async () => {
  const admin = await adminAccount();
  const id = await order("pending", "none", [supplierLine()]);
  const [line] = await lines(id);
  assert.equal(await orders.setLineProcurement({ orderId: id, productId: line.product_id, status: "ordered", reference: "REF-1", adminId: admin }), true);
  await assert.rejects(schema.pool.query("UPDATE commerce_order_items SET procurement_status='lost' WHERE order_id=$1", [id]));
  await schema.pool.query(await readFile("db/commerce.sql", "utf8"));
  const after = (await lines(id))[0];
  assert.equal(after.procurement_status, "ordered"); assert.equal(after.procurement_ref, "REF-1");
  await assert.rejects(schema.pool.query("UPDATE commerce_order_items SET procurement_status='lost' WHERE order_id=$1", [id]));
});

test("open procurement counts orders still to be handled with a supplier line not yet procured", async () => {
  const admin = await adminAccount();
  const open = await order("pending", "paid", [supplierLine(), storeLine]);
  const done = await order("confirmed", "paid", [supplierLine()]);
  const [doneLine] = await lines(done);
  await orders.setLineProcurement({ orderId: done, productId: doneLine.product_id, status: "procured", reference: "", adminId: admin });
  const storeOnly = await order("pending", "paid", [storeLine]);
  const shipped = await order("shipped", "paid", [supplierLine()]);
  const counted = new Set((await schema.pool.query<{ id: string }>(`SELECT o.id::text FROM commerce_orders o WHERE o.id=ANY($1::uuid[]) AND ${procurementOpenSql}`,
    [[open, done, storeOnly, shipped]])).rows.map(r => r.id));
  assert.deepEqual([...counted], [open]);
});

test("line figures, supplier links and the procurement summary", () => {
  assert.deepEqual(lineFigures({ cost_kurus: 500, vat_percent: 20 }, 1200), { costKurus: 500, netSaleKurus: 1000, marginKurus: 500 });
  // Lines written before #580 only carry the list price and its exchange rate; numeric values may arrive as strings.
  assert.deepEqual(lineFigures({ nf: "12.5", exchange_rate: 36.25, vat_percent: "20" }, 60000), { costKurus: 45313, netSaleKurus: 50000, marginKurus: 4687 });
  assert.deepEqual(lineFigures({}, 1000), { costKurus: null, netSaleKurus: null, marginKurus: null });
  assert.equal(lineFigures({ cost_kurus: 1100, vat_percent: 20 }, 1200).marginKurus, -100);
  assert.equal(supplierItemHref("manual", "abc"), "/yonetim/tedarikciler/manuel/urun/abc");
  assert.equal(supplierItemHref("basbug", "abc"), "/yonetim/tedarikciler/basbug/urun/abc");
  assert.equal(supplierItemHref("demo", "abc"), null);
  const line = (source: string, procurement_status: "pending" | "ordered" | "procured", liveCheckFailed = false) =>
    ({ needsProcurement: needsProcurement({ pricing_snapshot: { source } }), procurement_status, liveCheckFailed });
  assert.deepEqual(procurementSummary([line("store", "pending"), line("supplier", "pending", true), line("override", "ordered"), line("supplier", "procured")]),
    { needed: 3, pending: 1, ordered: 1, procured: 1, unverified: 1 });
  assert.deepEqual(procurementSummary([line("store", "pending")]), { needed: 0, pending: 0, ordered: 0, procured: 0, unverified: 0 });
  // The dialog's view model carries figures and links, never the raw snapshot.
  const view = orderLineView({ product_id: "p1", code: "C", name: "N", supplier: "seta", quantity: 2, unit_price_kurus: 1200,
    pricing_snapshot: { source: "supplier", cost_kurus: 500, vat_percent: 20, company: "SETA", warehouse: "D1", nf: 4 },
    procurement_status: "pending", procurement_ref: null, procurement_ordered_at: null, procured_at: null, supplier_item: true, master_id: "m1" }, "SETA");
  assert.equal(view.supplierHref, "/yonetim/tedarikciler/seta/urun/p1"); assert.equal(view.productHref, "/yonetim/urunler/m1");
  assert.equal(view.costKurus, 500); assert.equal(view.marginKurus, 500); assert.equal(view.company, "SETA"); assert.equal(view.needsProcurement, true);
  assert.equal("pricing_snapshot" in view, false);
  assert.equal(view.liveCheckFailed, false); assert.equal(view.liveCheckReason, null);
  // A line sold on saved data because the live check failed (#763) carries the marker and its reason.
  const unverified = orderLineView({ product_id: "p2", code: "B", name: "N", supplier: "basbug", quantity: 1, unit_price_kurus: 1200,
    pricing_snapshot: { source: "supplier", checkout_mode: "snapshot", live_check: "failed", live_check_reason: "timeout" },
    procurement_status: "pending", procurement_ref: null, procurement_ordered_at: null, procured_at: null, supplier_item: true, master_id: null }, "Başbuğ");
  assert.deepEqual([unverified.liveCheckFailed, unverified.liveCheckReason, unverified.checkoutMode], [true, "timeout", "snapshot"]);
  assert.equal(liveCheckReasonLabel.timeout, "zaman aşımı");
  assert.equal(procurementSummary([unverified, view]).unverified, 1);
});

test("the customer's order page never reads supplier, cost or procurement data", async () => {
  const source = await readFile("src/modules/store/order-read.ts", "utf8");
  assert.doesNotMatch(source, /procurement_|cost_kurus/);
  const query = source.match(/SELECT product_id,name,code[\s\S]*?FROM commerce_order_items/)?.[0] ?? "";
  assert.match(query, /jsonb_build_object\('checkout_mode',pricing_snapshot->'checkout_mode','observed_at',pricing_snapshot->'observed_at'\) AS pricing_snapshot/);
  assert.doesNotMatch(query.replace(/jsonb_build_object\([^)]*\) AS pricing_snapshot/, ""), /pricing_snapshot/);
  // The live-check marker (#763) stays in the admin panel; the customer only sees checkout_mode.
  assert.doesNotMatch(query, /live_check/);
  // The supplier / live-check lookup (#766) runs only for admins.
  assert.match(source, /isAdmin \?\s*db\.query[^\n]*supplier[^\n]*live_check[^\n]*:\s*null/);
});

test("the order page reads pending partner return requests only for admins (#1151)", async () => {
  const page = await readFile("src/app/(store)/siparis/[id]/page.tsx", "utf8");
  const calls = page.match(/orderPendingReturns\(/g) ?? [];
  assert.equal(calls.length, 1);
  assert.match(page, /=admin \? await Promise\.all\(\[orderReturns\(order\.id\),order\.owner_kind==="partner" \? orderPendingReturns\(order\.id\) : \[\]\]\) : \[\[\],\[\]\];/);
});
