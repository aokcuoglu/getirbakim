import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { refund } from "../src/modules/analytics/events";
import { isolatedSchema } from "./isolated-schema";

// GA4 refund event claim (#750) in an isolated copy of the schema: once per cancelled paid order, only for its own
// customer and only after the purchase was measured.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let claim: typeof import("../src/modules/store/refund-event").claimRefund;
let pending: typeof import("../src/modules/store/refund-event").refundEventPending;
let closeDb: () => Promise<void>;

const customer = { kind: "guest" as const, id: randomBytes(32).toString("hex") };
const stranger = { kind: "guest" as const, id: randomBytes(32).toString("hex") };

async function order(payment: string, { status = "cancelled", purchaseTracked = true, subtotal = 15000, shipping = 4990 } = {}) {
  return (await schema.pool.query<{ id: string; number: string }>(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,customer_name,email,phone,address,note,
    total_kurus,subtotal_kurus,shipping_kurus,discount_percent,status,payment_status,payment_due_at,paid_at,purchase_tracked_at)
    VALUES($1,$2,$3,'Gizli Müşteri','secret@example.invalid','5551234567','Gizli adres 12','Gizli not',$4,$5,$6,0,$7,$8,now()+interval '30 minutes',
    CASE WHEN $8 IN ('paid','refund_required','refunded') THEN now()-interval '1 day' END,CASE WHEN $9 THEN now() END) RETURNING id::text,number::text`,
  [customer.kind, customer.id, randomUUID(), subtotal + shipping, subtotal, shipping, status, payment, purchaseTracked])).rows[0];
}
const flag = async (id: string) => (await schema.pool.query<{ refund_tracked_at: Date | null }>(
  "SELECT refund_tracked_at FROM commerce_orders WHERE id=$1", [id])).rows[0].refund_tracked_at;
const setPayment = (id: string, payment: string) => schema.pool.query("UPDATE commerce_orders SET payment_status=$2 WHERE id=$1", [id, payment]);

before(async () => {
  schema = await isolatedSchema("refund_event_test");
  const [{ db }, module] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/refund-event")]);
  claim = module.claimRefund;
  pending = module.refundEventPending;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("refund(): the purchase's value and shipping, no items", () => {
  assert.deepEqual(refund({ transactionId: "1042", subtotalKurus: 12345, shippingKurus: 0 }),
    { transaction_id: "1042", currency: "TRY", value: 123.45, shipping: 0 });
});

test("the order's customer gets the refund once for a cancelled refund_required order", async () => {
  const placed = await order("refund_required");
  assert.equal(await pending(placed.id), true);
  // The customer's account plus this browser's guest cart; the order belongs to the guest one.
  const event = await claim(placed.id, [{ kind: "account", id: randomUUID() }, customer]);
  assert.deepEqual(event, { transaction_id: placed.number, currency: "TRY", value: 150, shipping: 49.9 });
  assert.doesNotMatch(JSON.stringify(event), /Gizli|secret@|5551234567|email|phone|address|customer|note|items/);
  assert.ok(await flag(placed.id));
  assert.equal(await pending(placed.id), false);
  assert.equal(await claim(placed.id, [customer]), null);
});

test("a refunded order claims too", async () => {
  const placed = await order("refunded");
  const event = await claim(placed.id, [customer]);
  assert.ok(event);
  assert.equal(event.transaction_id, placed.number);
});

test("concurrent claims: exactly one payload", async () => {
  const placed = await order("refund_required");
  const results = await Promise.all(Array.from({ length: 5 }, () => claim(placed.id, [customer])));
  assert.equal(results.filter(Boolean).length, 1);
});

test("unmeasured purchases, strangers, no owners, paid and unpaid cancels, unknown ids: null, flag untouched", async () => {
  const placed = await order("refund_required");
  assert.equal(await claim(placed.id, [stranger]), null);
  assert.equal(await claim(placed.id, []), null);
  assert.equal(await claim(randomUUID(), [customer]), null);
  assert.equal(await pending(randomUUID()), false);
  assert.equal(await flag(placed.id), null);
  const others = [
    await order("refund_required", { purchaseTracked: false }),
    await order("refunded", { purchaseTracked: false }),
    await order("paid", { status: "pending" }),
    await order("cancelled"),
    await order("expired"),
  ];
  for (const other of others) {
    assert.equal(await pending(other.id), false);
    assert.equal(await claim(other.id, [customer]), null);
    assert.equal(await flag(other.id), null);
  }
});

test("refunded → refund_required → refunded after the claim: never a second event", async () => {
  const placed = await order("refunded");
  assert.ok(await claim(placed.id, [customer]));
  await setPayment(placed.id, "refund_required");
  assert.equal(await claim(placed.id, [customer]), null);
  await setPayment(placed.id, "refunded");
  assert.equal(await claim(placed.id, [customer]), null);
});

test("re-applying db/commerce.sql keeps the flag", async () => {
  const placed = await order("refund_required");
  assert.ok(await claim(placed.id, [customer]));
  const claimed = await flag(placed.id);
  await schema.pool.query(await readFile("db/commerce.sql", "utf8"));
  assert.deepEqual(await flag(placed.id), claimed);
  assert.equal(await claim(placed.id, [customer]), null);
});
