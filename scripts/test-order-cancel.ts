import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import type { CartOwner } from "../src/modules/store/cart";

// Customer order cancel (#607) in an isolated copy of the schema. Every TAMI query reply is mocked and signed with a
// synthetic key; no provider request is made.
const env: Record<string, string> = {
  TAMI_MERCHANT_NUMBER: "test-merchant", TAMI_TERMINAL_NUMBER: "test-terminal", TAMI_SECRET_KEY: "synthetic-test-secret",
  TAMI_JWK_KID: "test-kid", TAMI_JWK_K: Buffer.from("synthetic-test-hmac-key").toString("base64url"),
  TAMI_PAYMENT_API_BASE_URL: "https://sandbox-paymentapi.tami.com.tr", TAMI_PORTAL_BASE_URL: "https://sandbox-portal.tami.com.tr",
};
const originalEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
Object.assign(process.env, env);

let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let cancel: typeof import("../src/modules/store/customer-cancel");
let checkout: typeof import("../src/modules/payments/checkout");
let adminOrders: typeof import("../src/modules/admin/orders");
let refundRules: typeof import("../src/modules/payments/refund-rules");
let tami: typeof import("../src/modules/payments/tami");
let closeDb: () => Promise<void>;
let product = "";

// TAMI query mock: paid attempts (provider orderId -> amount in TL); anything else is a signed "no transaction" (2013).
const paid = new Map<string, number>();
let calls = 0, queryDown = false, forgeMissing = false;
const originalFetch = globalThis.fetch;

const customer = { kind: "guest" as const, id: randomBytes(32).toString("hex") };
const stranger = { kind: "guest" as const, id: randomBytes(32).toString("hex") };

type Line = { quantity: number; reserved: number; supplier?: boolean; procurement?: "pending" | "ordered" | "procured" };
async function order(status: string, payment: string, lines: Line[] = [{ quantity: 2, reserved: 2 }], { due = null as string | null } = {}) {
  const id = (await schema.pool.query<{ id: string }>(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,customer_name,email,phone,address,
    total_kurus,subtotal_kurus,discount_percent,status,payment_status,payment_due_at,paid_at)
    VALUES($1,$2,$3,'Test','t@example.invalid','5551234567','Test address',20000,20000,0,$4,$5,COALESCE($6::timestamptz,now()+interval '30 minutes'),
    CASE WHEN $5='paid' THEN now() END) RETURNING id::text`,
  [customer.kind, customer.id, randomUUID(), status, payment, due])).rows[0].id;
  for (const line of lines) {
    await schema.pool.query(`INSERT INTO commerce_order_items(order_id,product_id,code,name,supplier,quantity,unit_price_kurus,pricing_snapshot,reserved_quantity,procurement_status)
      VALUES($1,$2,'X','Line','demo',$3,10000,$4,$5,$6)`, [id, line.supplier ? randomUUID() : product, line.quantity,
      JSON.stringify(line.supplier ? { source: "basbug" } : { source: "store" }), line.reserved, line.procurement ?? "pending"]);
  }
  return id;
}
/** An open hosted-page attempt; `succeeded` records an already captured one. */
async function attempt(orderId: string, status: "pending" | "succeeded" = "pending") {
  const providerOrderId = `GB2-test-${randomBytes(4).toString("hex")}`;
  const row = (await schema.pool.query<{ id: string }>(`INSERT INTO commerce_payments(order_id,provider_order_id,amount_kurus,status,hosted_url,paid_at)
    VALUES($1,$2,20000,$3,'https://example.invalid/pay',CASE WHEN $3='succeeded' THEN now() END) RETURNING id::text`, [orderId, providerOrderId, status])).rows[0];
  return { id: row.id, providerOrderId };
}
const stock = async () => (await schema.pool.query<{ stock: number }>("SELECT stock FROM store_products WHERE id=$1", [product])).rows[0].stock;
const setStock = (value: number) => schema.pool.query("UPDATE store_products SET stock=$2 WHERE id=$1", [product, value]);
const row = async (id: string) => (await schema.pool.query("SELECT * FROM commerce_orders WHERE id=$1", [id])).rows[0];
const reserved = async (id: string) => (await schema.pool.query<{ reserved_quantity: number }>(
  "SELECT reserved_quantity FROM commerce_order_items WHERE order_id=$1 ORDER BY quantity", [id])).rows.map(r => r.reserved_quantity);
const payments = async (id: string) => (await schema.pool.query<{ id: string; provider_order_id: string; status: string; amount_kurus: string; paid_at: Date | null }>(
  "SELECT id::text,provider_order_id,status,amount_kurus::text,paid_at FROM commerce_payments WHERE order_id=$1 ORDER BY created_at", [id])).rows;
const run = (id: string, expected: "awaiting_payment" | "pending", owners: CartOwner[] = [customer]) => cancel.cancelOrderByCustomer(id, owners, expected);

before(async () => {
  schema = await isolatedSchema("order_cancel_test");
  product = (await schema.pool.query<{ id: string }>(`INSERT INTO store_products(supplier,code,name,brand,price_kurus,stock)
    VALUES('demo','CNL-1','Cancel part','TEST',10000,10) RETURNING id::text`)).rows[0].id;
  const [{ db }, cancelModule, checkoutModule, ordersModule, rules, tamiModule] = await Promise.all([import("../src/lib/db"),
    import("../src/modules/store/customer-cancel"), import("../src/modules/payments/checkout"), import("../src/modules/admin/orders"),
    import("../src/modules/payments/refund-rules"), import("../src/modules/payments/tami")]);
  cancel = cancelModule; checkout = checkoutModule; adminOrders = ordersModule; refundRules = rules; tami = tamiModule;
  closeDb = () => db.end();
  globalThis.fetch = async (_input, init) => {
    calls++;
    if (queryDown) throw new Error("network down");
    const body = JSON.parse(String(init?.body ?? "{}"));
    const amount = paid.get(body.orderId);
    if (amount === undefined) {
      const payload = { errorMessage: "Bu sipariş üye işyerine ait değildir.", success: false, errorCode: 2013 };
      return Response.json({ ...payload, securityHash: forgeMissing ? "aaa.bbb.ccc" : tami.buildSecurityHash(payload) }, { status: 400 });
    }
    const payload = { success: true, orderId: body.orderId, currency: "TRY", amount, orderStatus: "AUTH", installmentCount: 1,
      transactions: [{ transactionType: "AUTH", transactionStatus: "SUCCESS", bankReferenceNumber: `REF-${body.orderId}`, bankAuthCode: "123456" }] };
    return Response.json({ ...payload, securityHash: tami.buildSecurityHash(payload) });
  };
});
beforeEach(async () => { await setStock(10); calls = 0; queryDown = false; forgeMissing = false; });
after(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await closeDb?.(); await schema?.drop();
});

test("another visitor's cancel is refused without a trace or a provider call", async () => {
  const id = await order("awaiting_payment", "awaiting");
  await attempt(id);
  const before = await row(id);
  assert.equal(await run(id, "awaiting_payment", [stranger]), "missing");
  assert.equal(await run(id, "awaiting_payment", []), "missing");
  assert.equal(await run(randomUUID(), "awaiting_payment"), "missing");
  assert.equal(calls, 0);
  assert.deepEqual(await row(id), before);
  assert.deepEqual(await reserved(id), [2]);
});

test("an unpaid order is cancelled once: stock returns once, the payment status says nothing was charged", async () => {
  await setStock(8);
  const id = await order("awaiting_payment", "awaiting");
  // The customer's account plus this browser's guest cart; the order belongs to the guest one.
  assert.equal(await run(id, "awaiting_payment", [{ kind: "account", id: randomUUID() }, customer]), "cancelled");
  const cancelled = await row(id);
  assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.payment_status, "cancelled");
  assert.equal(cancelled.cancelled_by, "customer"); assert.ok(cancelled.cancelled_at instanceof Date);
  assert.equal(await stock(), 10); assert.deepEqual(await reserved(id), [0]);
  assert.equal(calls, 0);
  // A second cancel (double click, another tab) is a no-op.
  assert.equal(await run(id, "awaiting_payment"), "already");
  assert.equal(await stock(), 10);

  // Two requests at once release the stock once.
  await setStock(8);
  const raced = await order("awaiting_payment", "awaiting");
  const results = await Promise.all([run(raced, "awaiting_payment"), run(raced, "awaiting_payment")]);
  assert.deepEqual(results.sort(), ["already", "cancelled"]);
  assert.equal(await stock(), 10);
});

test("an open attempt is queried first; a signed 'no transaction' lets the cancel through", async () => {
  await setStock(8);
  const id = await order("awaiting_payment", "awaiting");
  await attempt(id);
  assert.equal(await run(id, "awaiting_payment"), "cancelled");
  assert.equal(calls, 1);
  assert.equal((await row(id)).payment_status, "cancelled");
  assert.equal(await stock(), 10);
});

test("payment race: a paid attempt stops the cancel; the customer can then cancel the paid order for a refund", async () => {
  await setStock(8);
  const id = await order("awaiting_payment", "awaiting");
  const { providerOrderId } = await attempt(id);
  paid.set(providerOrderId, 200);
  assert.equal(await run(id, "awaiting_payment"), "paid");
  let current = await row(id);
  assert.equal(current.status, "pending"); assert.equal(current.payment_status, "paid"); assert.equal(current.cancelled_by, null);
  assert.equal(await stock(), 8); assert.deepEqual(await reserved(id), [2]);

  assert.equal(await run(id, "pending"), "refund");
  current = await row(id);
  assert.equal(current.status, "cancelled"); assert.equal(current.payment_status, "refund_required"); assert.equal(current.cancelled_by, "customer");
  assert.match(current.payment_note, /Müşteri iptal etti\./); assert.doesNotMatch(current.payment_note, /tedarikçiye/);
  assert.equal(await stock(), 10); assert.deepEqual(await reserved(id), [0]);
  const refundable = refundRules.refundablePayments(current, await payments(id), []);
  assert.deepEqual(refundable.map(p => p.provider_order_id), [providerOrderId]);
  assert.equal(await run(id, "pending"), "already");
});

test("a page showing 'awaiting payment' never cancels an order that is paid by now", async () => {
  await setStock(8);
  const id = await order("pending", "paid");
  assert.equal(await run(id, "awaiting_payment"), "paid");
  assert.equal((await row(id)).status, "pending"); assert.equal(await stock(), 8);
  // And the reverse: an order still awaiting payment is not cancelled from a page that showed it pending.
  const awaiting = await order("awaiting_payment", "awaiting");
  assert.equal(await run(awaiting, "pending"), "closed");
  assert.equal((await row(awaiting)).status, "awaiting_payment");
});

test("an unanswered or unsigned provider reply leaves the order as it was", async () => {
  await setStock(8);
  const id = await order("awaiting_payment", "awaiting");
  await attempt(id);
  queryDown = true;
  assert.equal(await run(id, "awaiting_payment"), "unverified");
  queryDown = false; forgeMissing = true;
  assert.equal(await run(id, "awaiting_payment"), "unverified");
  forgeMissing = false;
  const current = await row(id);
  assert.equal(current.status, "awaiting_payment"); assert.equal(current.payment_status, "awaiting"); assert.equal(current.cancelled_by, null);
  assert.equal(await stock(), 8); assert.deepEqual(await reserved(id), [2]);
});

test("a payment landing after the customer cancelled keeps the order cancelled and asks for a refund", async () => {
  await setStock(8);
  const id = await order("awaiting_payment", "awaiting");
  const first = await attempt(id);
  assert.equal(await run(id, "awaiting_payment"), "cancelled");
  assert.equal(await stock(), 10);
  paid.set(first.providerOrderId, 200);
  await checkout.reconcileOrderPayments(id);
  let current = await row(id);
  assert.equal(current.status, "cancelled"); assert.equal(current.payment_status, "refund_required"); assert.equal(current.cancelled_by, "customer");
  assert.ok(current.paid_at instanceof Date);
  assert.match(current.payment_note, new RegExp(`Müşteri iptal ettikten sonra ödeme alındı \\(${first.providerOrderId}\\)`));
  // No stock is taken again.
  assert.equal(await stock(), 10); assert.deepEqual(await reserved(id), [0]);
  assert.deepEqual(refundRules.refundablePayments(current, await payments(id), []).map(p => p.provider_order_id), [first.providerOrderId]);
  // A second capture is a duplicate payment to refund as well.
  const second = await attempt(id);
  paid.set(second.providerOrderId, 200);
  await checkout.reconcileOrderPayments(id);
  current = await row(id);
  assert.equal(current.status, "cancelled"); assert.equal(current.payment_status, "refund_required");
  assert.match(current.payment_note, /Mükerrer ödeme alındı/);
  assert.equal(refundRules.refundablePayments(current, await payments(id), []).length, 2);
  assert.equal(await stock(), 10);
  // A payment that does not settle the order sends no confirmation email (#951).
  assert.equal((await schema.pool.query("SELECT 1 FROM commerce_order_emails WHERE order_id=$1", [id])).rowCount, 0);
  // Without a recorded customer cancel the note does not claim one.
  const unattributed = await order("cancelled", "cancelled", [{ quantity: 1, reserved: 0 }]);
  const third = await attempt(unattributed);
  paid.set(third.providerOrderId, 200);
  await checkout.reconcileOrderPayments(unattributed);
  const note = (await row(unattributed)).payment_note;
  assert.match(note, /İptal edilen siparişe ödeme alındı/); assert.doesNotMatch(note, /Müşteri/);
});

test("confirmed, shipped, delivered and orders cancelled by operations or expiry are closed to the customer", async () => {
  for (const status of ["confirmed", "shipped", "delivered"]) {
    const id = await order(status, "paid");
    assert.equal(await run(id, "pending"), "closed", status);
    assert.equal((await row(id)).status, status);
  }
  await setStock(8);
  const admin = await order("pending", "paid");
  assert.equal(await adminOrders.transitionOrder(admin, "cancelled"), true);
  assert.equal(await run(admin, "pending"), "closed");
  assert.equal((await row(admin)).cancelled_by, "admin"); assert.equal(await stock(), 10);

  await setStock(8);
  const expired = await order("awaiting_payment", "awaiting", undefined, { due: new Date(Date.now() - 60_000).toISOString() });
  // The query-first step finds no attempt and lets the order expire; the customer cannot cancel it on top of that.
  assert.equal(await run(expired, "awaiting_payment"), "closed");
  const current = await row(expired);
  assert.equal(current.payment_status, "expired"); assert.equal(current.cancelled_by, "expiry");
  assert.equal(await stock(), 10);
  // refund_required already (operations cancel of a paid order) or refunded: closed too.
  assert.equal(await run(await order("cancelled", "refunded"), "pending"), "closed");
});

test("customer cancel and operations' confirmation race: exactly one wins", async () => {
  for (let i = 0; i < 5; i++) {
    await setStock(8);
    const id = await order("pending", "paid");
    const [customerResult, confirmed] = await Promise.all([run(id, "pending"), adminOrders.transitionOrder(id, "confirmed")]);
    const current = await row(id);
    if (confirmed) {
      assert.equal(customerResult, "closed"); assert.equal(current.status, "confirmed"); assert.equal(await stock(), 8);
    } else {
      assert.equal(customerResult, "refund"); assert.equal(current.status, "cancelled"); assert.equal(await stock(), 10);
    }
  }
});

test("cancelling after a supplier line was ordered tells operations to check the supplier order", async () => {
  await setStock(8);
  const id = await order("pending", "paid", [{ quantity: 2, reserved: 2 }, { quantity: 3, reserved: 0, supplier: true, procurement: "ordered" }]);
  assert.equal(await run(id, "pending"), "refund");
  const current = await row(id);
  assert.equal(current.status, "cancelled"); assert.equal(current.payment_status, "refund_required");
  assert.match(current.payment_note, /Müşteri iptal etti\. İptal anında 1 kalem tedarikçiye sipariş edilmiş \/ 0 kalem tedarik edilmişti; tedarikçi siparişini kontrol edin\./);
  assert.equal(await stock(), 10);
  // A legacy offline order (no online payment) is cancelled without a refund.
  const offline = await order("pending", "none");
  assert.equal(await run(offline, "pending"), "cancelled");
  assert.equal((await row(offline)).payment_status, "none");
});
