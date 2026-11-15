import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";

// GA4 purchase event claim (#675) in an isolated copy of the schema: once per order, only for its own customer.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let claim: typeof import("../src/modules/store/purchase-event").claimPurchase;
let closeDb: () => Promise<void>;
let disc = "", pad = "";

const customer = { kind: "guest" as const, id: randomBytes(32).toString("hex") };
const stranger = { kind: "guest" as const, id: randomBytes(32).toString("hex") };

type Line = { product: string; quantity: number; unit: number; vat?: number };
async function order(payment: string, lines: Line[], { paidDaysAgo = 0, shipping = 4990, status = "pending" } = {}) {
  const subtotal = lines.reduce((sum, line) => sum + line.unit * line.quantity, 0);
  const row = (await schema.pool.query<{ id: string; number: string }>(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,customer_name,email,phone,address,note,
    total_kurus,subtotal_kurus,shipping_kurus,discount_percent,status,payment_status,payment_due_at,paid_at)
    VALUES($1,$2,$3,'Gizli Müşteri','secret@example.invalid','5551234567','Gizli adres 12','Gizli not',$4,$5,$6,0,$7,$8,now()+interval '30 minutes',
    CASE WHEN $8 IN ('paid','refund_required') THEN now()-make_interval(days => $9) END) RETURNING id::text,number::text`,
  [customer.kind, customer.id, randomUUID(), subtotal + shipping, subtotal, shipping, status, payment, paidDaysAgo])).rows[0];
  for (const line of lines) {
    await schema.pool.query(`INSERT INTO commerce_order_items(order_id,product_id,code,name,supplier,quantity,unit_price_kurus,pricing_snapshot)
      VALUES($1,$2,'X','Satır adı','demo',$3,$4,$5)`, [row.id, line.product, line.quantity, line.unit,
      JSON.stringify(line.vat === undefined ? { source: "store" } : { source: "supplier", vat_percent: line.vat })]);
  }
  return row;
}
const flag = async (id: string) => (await schema.pool.query<{ purchase_tracked_at: Date | null }>(
  "SELECT purchase_tracked_at FROM commerce_orders WHERE id=$1", [id])).rows[0].purchase_tracked_at;

before(async () => {
  schema = await isolatedSchema("purchase_event_test");
  const insert = (code: string, name: string, brand: string) => schema.pool.query<{ id: string }>(`INSERT INTO store_products(supplier,code,name,brand,price_kurus,stock)
    VALUES('demo',$1,$2,$3,10000,10) RETURNING id::text`, [code, name, brand]);
  disc = (await insert("PE-DISC", "Fren Diski", "BOSCH")).rows[0].id;
  pad = (await insert("PE-PAD", "Fren Balatası", "TRW")).rows[0].id;
  const [{ db }, module] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/purchase-event")]);
  claim = module.claimPurchase;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("the order's customer gets the payload once; value + shipping is the order total", async () => {
  const placed = await order("paid", [{ product: disc, quantity: 2, unit: 6000 }, { product: pad, quantity: 1, unit: 3000 }]);
  // The customer's account plus this browser's guest cart; the order belongs to the guest one.
  const event = await claim(placed.id, [{ kind: "account", id: randomUUID() }, customer]);
  assert.ok(event);
  assert.equal(event.transaction_id, placed.number);
  assert.equal(event.currency, "TRY");
  assert.equal(event.value, 150);
  assert.equal(event.value, event.items.reduce((sum, item) => sum + item.price * item.quantity, 0));
  assert.equal(event.shipping, 49.9);
  assert.equal(Math.round((event.value + event.shipping) * 100), 15000 + 4990);
  // No snapshot rate: the store's 20 % VAT, 12000 → 2000, 3000 → 500.
  assert.equal(event.tax, 25);
  assert.deepEqual(event.items.map(item => [item.item_brand, item.quantity, item.index]), [["BOSCH", 2, 0], ["TRW", 1, 1]]);
  assert.match(event.items[0].item_name, /Fren Diski/);
  assert.equal(event.items[0].item_id, disc);
  const text = JSON.stringify(event);
  assert.doesNotMatch(text, /Gizli|secret@|5551234567|email|phone|address|customer|note/);
  assert.ok(await flag(placed.id));
  assert.equal(await claim(placed.id, [customer]), null);
});

test("concurrent claims: exactly one payload", async () => {
  const placed = await order("paid", [{ product: disc, quantity: 1, unit: 6000 }]);
  const results = await Promise.all(Array.from({ length: 5 }, () => claim(placed.id, [customer])));
  assert.equal(results.filter(Boolean).length, 1);
});

test("strangers, no owners, unpaid, refunded, cancelled and old orders: null, flag untouched", async () => {
  const paid = await order("paid", [{ product: disc, quantity: 1, unit: 6000 }]);
  assert.equal(await claim(paid.id, [stranger]), null);
  assert.equal(await claim(paid.id, []), null);
  assert.equal(await claim(randomUUID(), [customer]), null);
  assert.equal(await flag(paid.id), null);
  const others = [
    await order("awaiting", [{ product: disc, quantity: 1, unit: 6000 }], { status: "awaiting_payment" }),
    await order("refund_required", [{ product: disc, quantity: 1, unit: 6000 }], { status: "cancelled" }),
    await order("cancelled", [{ product: disc, quantity: 1, unit: 6000 }], { status: "cancelled" }),
    await order("paid", [{ product: disc, quantity: 1, unit: 6000 }], { paidDaysAgo: 8 }),
  ];
  for (const other of others) {
    assert.equal(await claim(other.id, [customer]), null);
    assert.equal(await flag(other.id), null);
  }
  // Still inside the window.
  assert.ok(await claim((await order("paid", [{ product: disc, quantity: 1, unit: 6000 }], { paidDaysAgo: 6 })).id, [customer]));
});

test("the line's snapshot VAT wins over the store rate; 0 % adds none", async () => {
  const placed = await order("paid", [{ product: disc, quantity: 1, unit: 11000, vat: 10 }, { product: pad, quantity: 1, unit: 5000, vat: 0 }], { shipping: 0 });
  const event = await claim(placed.id, [customer]);
  assert.ok(event);
  assert.equal(event.tax, 10);
  assert.equal(event.shipping, 0);
  assert.equal(event.value, 160);
});

test("a product gone from the catalog keeps the order line's name and still claims", async () => {
  const gone = (await schema.pool.query<{ id: string }>(`INSERT INTO store_products(supplier,code,name,brand,price_kurus,stock)
    VALUES('demo','PE-GONE','Silinen parça','ACME',10000,10) RETURNING id::text`)).rows[0].id;
  const placed = await order("paid", [{ product: gone, quantity: 3, unit: 2000 }]);
  await schema.pool.query("DELETE FROM store_products WHERE id=$1", [gone]);
  const event = await claim(placed.id, [customer]);
  assert.ok(event);
  assert.deepEqual(event.items.map(item => [item.item_id, item.item_name, item.item_brand, item.price, item.quantity]), [[gone, "Satır adı", "", 20, 3]]);
  assert.equal(event.value, 60);
  assert.ok(await flag(placed.id));
});

test("re-applying db/commerce.sql keeps the flag", async () => {
  const placed = await order("paid", [{ product: disc, quantity: 1, unit: 6000 }]);
  assert.ok(await claim(placed.id, [customer]));
  const claimed = await flag(placed.id);
  await schema.pool.query(await readFile("db/commerce.sql", "utf8"));
  assert.deepEqual(await flag(placed.id), claimed);
  assert.equal(await claim(placed.id, [customer]), null);
});
