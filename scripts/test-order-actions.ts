import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { orderListBack, orderListReturn } from "../src/modules/admin/order-list-return";

// Admin order steps (#516) in an isolated copy of the schema; nothing touches the shared database's tables.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let orders: typeof import("../src/modules/admin/orders");
let services: typeof import("../src/modules/admin/service-accounts");
let payments: typeof import("../src/modules/payments/checkout");
let closeDb: () => Promise<void>;
let product = "", spare = "";

type Line = { quantity: number; reserved: number | null; product?: "spare" | "supplier" };
async function order(status: string, payment: string, lines: Line[], { note = "", due = null as string | null } = {}) {
  const id = (await schema.pool.query<{ id: string }>(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,customer_name,email,phone,address,
    total_kurus,subtotal_kurus,discount_percent,status,payment_status,payment_note,payment_due_at)
    VALUES('guest',$1,$2,'Test','t@example.invalid','5551234567','Test address',10000,10000,0,$3,$4,$5,$6::timestamptz) RETURNING id::text`,
  [randomUUID(), randomUUID(), status, payment, note, due])).rows[0].id;
  for (const line of lines) {
    await schema.pool.query(`INSERT INTO commerce_order_items(order_id,product_id,code,name,supplier,quantity,unit_price_kurus,pricing_snapshot,reserved_quantity)
      VALUES($1,$2,'X','Line','demo',$3,1000,'{}',$4)`, [id, line.product === "supplier" ? randomUUID() : line.product === "spare" ? spare : product, line.quantity, line.reserved]);
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
  // A stale outcome and unknown parameters are dropped.
  assert.equal(orderListReturn("/yonetim/siparisler?status=refund&error=1&x=y", "saved"), "/yonetim/siparisler?status=refund&saved=1");
  for (const value of ["//evil.example/yonetim/siparisler", "https://evil.example/yonetim/siparisler", "/yonetim/siparislerX", "/yonetim/urunler?status=action",
    "javascript:alert(1)", "/\\evil.example", "", null, undefined, ["/yonetim/siparisler"]]) {
    assert.equal(orderListReturn(value, "saved"), "/yonetim/siparisler?saved=1", String(value));
  }
  assert.equal(orderListBack.safeParse("//evil.example").success, false);
  assert.equal(orderListBack.safeParse("/yonetim/siparisler?page=2").success, true);
});

test("order steps follow the state machine and only for paid or legacy offline orders", async () => {
  const paid = await order("pending", "paid", [{ quantity: 1, reserved: 1 }]);
  assert.equal(await orders.transitionOrder(paid, "shipped"), false);
  assert.equal(await orders.transitionOrder(paid, "confirmed"), true);
  assert.equal((await row(paid)).status, "confirmed");
  assert.equal(await orders.transitionOrder(paid, "confirmed"), false);
  assert.equal(await orders.transitionOrder(paid, "shipped"), true);
  assert.equal(await orders.transitionOrder(paid, "cancelled"), false);
  assert.equal((await row(paid)).status, "shipped");
  // An unpaid online order is left to expiry.
  const unpaid = await order("awaiting_payment", "awaiting", [{ quantity: 1, reserved: 1 }]);
  assert.equal(await orders.transitionOrder(unpaid, "confirmed"), false);
  assert.equal(await orders.transitionOrder(unpaid, "cancelled"), false);
  assert.equal((await row(unpaid)).status, "awaiting_payment");
  const offline = await order("pending", "none", [{ quantity: 1, reserved: 0 }]);
  assert.equal(await orders.transitionOrder(offline, "confirmed"), true);
  assert.equal(await orders.transitionOrder(randomUUID(), "confirmed"), false);
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
  // A second cancel is refused and cannot restore again.
  assert.equal(await orders.transitionOrder(id, "cancelled"), false);
  assert.equal(await stock(), 12);

  assert.equal(await orders.recordOrderRefund(id, "TAMI-REF-1"), true);
  const refunded = await row(id);
  assert.equal(refunded.payment_status, "refunded"); assert.equal(refunded.refund_reference, "TAMI-REF-1");
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
