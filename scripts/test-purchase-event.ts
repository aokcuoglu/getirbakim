import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import type { CartItem } from "../src/modules/store/cart";

// GA4 purchase event claim (#675) in an isolated copy of the schema: once per order, only for its own customer.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let claim: typeof import("../src/modules/store/purchase-event").claimPurchase;
let listingIds: typeof import("../src/modules/store/catalog").listingIds;
let cartItems: typeof import("../src/modules/analytics/cart-items.server").cartAnalyticsItems;
let closeDb: () => Promise<void>;
// A grouped product (#752): the primary row is what the storefront lists, secondary its cheaper offer, hiddenOffer belongs to a hidden primary.
const grouped: Record<"primary" | "secondary" | "hiddenPrimary" | "hiddenOffer" | "single", string> = { primary: "", secondary: "", hiddenPrimary: "", hiddenOffer: "", single: "" };
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
      VALUES($1,$2::uuid,COALESCE((SELECT code FROM store_products WHERE id::text=($2::uuid)::text),'X'),'Satır adı','demo',$3,$4,$5)`, [row.id, line.product, line.quantity, line.unit,
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
  const supplierItem = async (key: string) => (await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('basbug',$1,'G','MRK',$2,$3,'{"nf":100}','{"stok":2}',1,1,1,'present',now(),now(),now()) RETURNING id::text`,
  [storefrontCompanies()[0], `GRP ${key}`, { uk: "BOSCH", ac: `${key} PARCA`, ac2: "", dc: "TL" }])).rows[0].id;
  for (const key of Object.keys(grouped) as (keyof typeof grouped)[]) grouped[key] = await supplierItem(key);
  await schema.pool.query("INSERT INTO product_offers(item_id,primary_id) VALUES($1,$1),($2,$1),($3,$3),($4,$3)",
    [grouped.primary, grouped.secondary, grouped.hiddenPrimary, grouped.hiddenOffer]);
  await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hidden) VALUES($1,$1,true)", [grouped.hiddenPrimary]);
  const [{ db }, module, catalog, cart] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/purchase-event"),
    import("../src/modules/store/catalog"), import("../src/modules/analytics/cart-items.server")]);
  claim = module.claimPurchase;
  listingIds = catalog.listingIds;
  cartItems = cart.cartAnalyticsItems;
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

test("listingIds maps a grouped offer to its listing row; primary, ungrouped, hidden-primary and unknown ids stay absent", async () => {
  assert.equal((await listingIds([])).size, 0);
  const map = await listingIds([grouped.primary, grouped.secondary, grouped.single, grouped.hiddenOffer, randomUUID()]);
  assert.deepEqual([...map], [[grouped.secondary, grouped.primary]]);
});

test("the purchase line of a secondary offer reports the listing id; the cart line keeps the offer id", async () => {
  const placed = await order("paid", [{ product: grouped.secondary, quantity: 2, unit: 5000 }, { product: grouped.single, quantity: 1, unit: 3000 }]);
  const event = await claim(placed.id, [customer]);
  assert.ok(event);
  assert.deepEqual(event.items.map(item => item.item_id), [grouped.primary, grouped.single]);
  const stored = await schema.pool.query<{ product_id: string }>("SELECT product_id::text FROM commerce_order_items WHERE order_id=$1 AND product_id=$2", [placed.id, grouped.secondary]);
  assert.equal(stored.rowCount, 1);
});

test("cartAnalyticsItems: productId is the offer, item_id the listing id", async () => {
  const line = (id: string) => ({ id, name: "Parça", name_overridden: false, code: "C", display_code: "C", brand: "BOSCH", display_brand: "BOSCH", price_kurus: 10000, quantity: 1 }) as CartItem;
  const lines = await cartItems([line(grouped.secondary), line(grouped.single), line(grouped.hiddenOffer)], 0);
  assert.deepEqual(lines.map(entry => [entry.productId, entry.item.item_id]), [[grouped.secondary, grouped.primary], [grouped.single, grouped.single], [grouped.hiddenOffer, grouped.hiddenOffer]]);
});
