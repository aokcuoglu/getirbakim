import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import type { OrderRequest } from "../src/modules/partner/order-schema";
import type { PartnerOrderConfig } from "../src/modules/partner/orders";

// Partner orders (#426) end to end in an isolated copy of the schema: quote → order on account, idempotency, price and
// quote checks, tenant isolation, the open-order limit, and the store's payment and admin flows around on_account rows.
// Başbuğ is mocked (list import + live MalzemeAra); no supplier request leaves the process.
const env: Record<string, string> = {
  BASBUG_BASE_URL: "https://api.basbug.com.tr", BASBUG_USERNAME: "TEST", BASBUG_PASSWORD: "TEST", BASBUG_CLIENT_ID: "TEST",
  BASBUG_CLIENT_SECRET: "TEST", BASBUG_FIRMA_ADI: "TEST",
  // Route tests read the deployment settings from the environment.
  PARTNER_API_KEYS: `bakimx:${"k".repeat(24)}`, PARTNER_QUOTE_SIGNING_SECRET: "r".repeat(48), PARTNER_ORDER_LIMIT_KURUS: "10000000",
};
const unset = ["SUPPLIER_EGRESS_PROXY", "SUPPLIER_EGRESS_PROXY_FOR", "DINAMIK_BASE", "DINAMIK_APIKEY", "DINAMIK_SECRETKEY"];
const originalEnv = Object.fromEntries([...Object.keys(env), ...unset].map(key => [key, process.env[key]]));

let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let partnerOrders: typeof import("../src/modules/partner/orders");
let quotes: typeof import("../src/modules/partner/quotes");
let dto: typeof import("../src/modules/partner/dto");
let adminOrders: typeof import("../src/modules/admin/orders");
let checkout: typeof import("../src/modules/payments/checkout");
let reimport: () => Promise<unknown>;
let closeDb: () => Promise<void>;
let workDir = "";
const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;

// Başbuğ mock: price (nf, TL) and MRK stock per code.
const prices: Record<string, number> = {}, stocks: Record<string, number> = {};
let supplierCalls = 0;
// Codes MalzemeAra no longer knows (HTTP 604): the live check refuses them (#770).
const gone = new Set<string>();
let liveDown = false;
const codes = ["PART-A", "PART-B"];
const offers: Record<string, string> = {};

const secret = "s".repeat(48);
const config = (overrides: Partial<PartnerOrderConfig> = {}): PartnerOrderConfig => ({ discountBps: 0, secret, limitKurus: 10_000_000, ...overrides });
const address = { recipientName: "Usta Oto Servis", phone: "0532 000 00 00", province: "İstanbul", district: "Kadıköy", addressLine: "Test Mahallesi 1. Sokak No 2", email: "", postalCode: null };

async function quoteAndBody(lines: { code: string; quantity: number }[], partner = "bakimx", cfg = config()) {
  const quote = await partnerOrders.quotePartnerOrder(partner, { lines: lines.map(line => ({ selectedOfferId: offers[line.code], quantity: line.quantity })) }, cfg);
  const body: OrderRequest = {
    confirmationToken: quote.confirmationToken, note: "",
    lines: quote.lines.map(line => ({ selectedOfferId: line.selectedOfferId, quantity: line.quantity, expectedUnitNetKurus: line.unitNetKurus })),
    shippingAddress: address,
  };
  return { quote, body };
}
const refusal = (code: string, check: (details: Record<string, unknown> | undefined) => void = () => undefined) => (error: unknown) => {
  if (!(error instanceof quotes.PartnerOrderError) || error.code !== code) return false;
  check(error.details);
  return true;
};
const orderRow = async (id: string) => (await schema.pool.query("SELECT * FROM commerce_orders WHERE id=$1", [id])).rows[0];
const orderCount = async () => Number((await schema.pool.query("SELECT count(*) FROM commerce_orders")).rows[0].count);

before(async () => {
  schema = await isolatedSchema("partner_orders_test");
  Object.assign(process.env, env);
  for (const key of unset) delete process.env[key];
  // The Başbuğ client keeps its pause marker in the working directory: keep the operator's real one out of reach.
  workDir = await mkdtemp(join(tmpdir(), "getirbakim-partner-orders-"));
  process.chdir(workDir);
  for (const code of codes) { prices[code] = 100; stocks[code] = 5; }
  globalThis.fetch = async input => {
    supplierCalls++;
    const url = String(input);
    const asked = url.includes("/material/MalzemeAra") ? new URL(url).searchParams.get("MalzemeNo") ?? "" : "";
    // new Response rejects 604, as in scripts/test-supplier-checkout.ts.
    if (asked && liveDown) throw new Error("network down");
    if (gone.has(asked)) return { ok: false, status: 604, json: async () => { throw new Error("not JSON"); }, text: async () => "Malzeme bulunamadı!" } as unknown as Response;
    const item = (code: string) => ({ no: code, ac: `Part ${code}`, ac2: "", uk: "TEST", oe: "", lgk: "FIAT", m: "", mo: "", y: "", b: "ADET", dc: "TL", lf: 10, mkk: "" });
    const body = url.includes("/auth/Login") ? { token: "test", tokenTipi: "Bearer", tokenBitisSuresi: 300 }
      : url.includes("/material/MalzemeAra") ? (() => {
        const code = new URL(url).searchParams.get("MalzemeNo") ?? "";
        return { no: code, ac: `Part ${code}`, uk: "TEST", dc: "TL", nf: prices[code], mif: prices[code], k: 0, sMrk: stocks[code], sIzm: 0, sAnk: 0, sAdn: 0, sErz: 0, sYol: 0 };
      })()
      : url.includes("ListeGrubuGetir") ? { malzemeGruplariListesi: [{ kod: "FIAT", ad: "FIAT" }] }
      : url.includes("MalzemeleriGetir") ? { malzemeListesi: codes.map(item) }
      : url.includes("FiyatGetir") ? { fiyatListesi: codes.map(code => ({ no: code, nf: prices[code], mif: prices[code], k: 0 })) }
      : url.includes("StokGetir") ? { stokListesi: codes.map(code => ({ no: code, stok: stocks[code], sYol: 0, sDepo: new URL(url).searchParams.get("Depo"), sFarkliDepo: 0 })) }
      : { dovizListesi: [{ dovizCinsi: "EUR", alis: "39", satis: "40" }] };
    return Response.json(body);
  };
  const [{ db }, basbug, ordersModule, quotesModule, dtoModule, adminModule, checkoutModule] = await Promise.all([import("../src/lib/db"),
    import("../src/modules/suppliers/basbug-import"), import("../src/modules/partner/orders"), import("../src/modules/partner/quotes"),
    import("../src/modules/partner/dto"), import("../src/modules/admin/orders"), import("../src/modules/payments/checkout")]);
  partnerOrders = ordersModule; quotes = quotesModule; dto = dtoModule; adminOrders = adminModule; checkout = checkoutModule;
  closeDb = () => db.end();
  await basbug.importBasbug(db, { group: "FIAT", warehouse: "MRK", company: "TEST" });
  // A live check saves what the supplier said: each test starts from the mock's list again.
  reimport = () => basbug.importBasbug(db, { group: "FIAT", warehouse: "MRK", company: "TEST", mode: "commerce" });
  for (const row of (await schema.pool.query<{ id: string; code: string }>("SELECT id::text,code FROM supplier_items")).rows) offers[row.code] = dto.encodeOfferId(row.id);
  assert.deepEqual(Object.keys(offers).sort(), codes);
});
beforeEach(async () => {
  for (const code of codes) { prices[code] = 100; stocks[code] = 5; }
  gone.clear(); liveDown = false;
  await reimport();
  supplierCalls = 0;
  // Each test starts without open partner orders, so the limit sees only its own.
  await schema.pool.query("UPDATE commerce_orders SET status='delivered' WHERE owner_kind='partner'");
  // The store's shipping rule (VAT included): 50.00 TL, free from 400.00 TL of goods.
  await schema.pool.query("UPDATE commerce_settings SET basbug_checkout_mode='live',shipping_fee_kurus=5000,free_shipping_threshold_kurus=40000");
});
after(async () => {
  globalThis.fetch = originalFetch;
  process.chdir(originalCwd);
  for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await closeDb?.(); await schema?.drop();
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

test("a multi-line quote becomes an order on account: pending, unpaid, nothing reserved, prices locked", async () => {
  const { quote, body } = await quoteAndBody([{ code: "PART-A", quantity: 2 }, { code: "PART-B", quantity: 1 }]);
  // nf 100 TL × 1.30 markup = 130.00 before VAT; 20% VAT on top.
  assert.deepEqual(quote.lines.map(line => [line.unitNetKurus, line.vatRateBps, line.lineNetKurus, line.lineVatKurus, line.lineGrossKurus]),
    [[13000, 2000, 26000, 5200, 31200], [13000, 2000, 13000, 2600, 15600]]);
  // 468.00 TL of goods reaches the 400.00 TL free shipping threshold.
  assert.deepEqual(quote.totals, { netKurus: 39000, vatKurus: 7800, shippingKurus: 0, grossKurus: 46800 });
  assert.ok(Date.parse(quote.expiresAt) - Date.now() > 14 * 60_000);
  const key = randomUUID();
  const created = await partnerOrders.createPartnerOrder("bakimx", key, body, config());
  assert.equal(created.replayed, false);
  assert.deepEqual([created.order.status, created.order.paymentStatus, created.order.idempotencyKey, created.order.totals.grossKurus], ["REQUESTED", "ON_ACCOUNT", key, 46800]);
  assert.deepEqual(created.order.lines.map(line => [line.selectedOfferId, line.quantity, line.unitNetKurus]), [[offers["PART-A"], 2, 13000], [offers["PART-B"], 1, 13000]]);
  // The live check asked the supplier for these codes.
  assert.ok(supplierCalls > 0);
  const row = await orderRow(created.order.id);
  assert.deepEqual([row.owner_kind, row.owner_id, row.status, row.payment_status, row.payment_due_at, row.paid_at, Number(row.total_kurus), Number(row.shipping_kurus)],
    ["partner", "bakimx", "pending", "on_account", null, null, 46800, 0]);
  assert.deepEqual([row.delivery_province, row.delivery_district, row.address], ["İstanbul", "Kadıköy", "Test Mahallesi 1. Sokak No 2, Kadıköy/İstanbul"]);
  assert.match(row.partner_fingerprint, /^[0-9a-f]{64}$/);
  const lines = (await schema.pool.query("SELECT * FROM commerce_order_items WHERE order_id=$1 ORDER BY code", [created.order.id])).rows;
  assert.deepEqual(lines.map(line => [line.reserved_quantity, Number(line.unit_price_kurus), line.fitment_level, line.pricing_snapshot.partner.unit_net_kurus, line.pricing_snapshot.live_check]),
    [[0, 15600, "no_vehicle", 13000, undefined], [0, 15600, "no_vehicle", 13000, undefined]]);
  assert.deepEqual(lines.map(line => line.pricing_snapshot.partner.line_gross_kurus), [31200, 15600]);
  // No payment attempt, no consumer pre-contract documents.
  assert.equal((await schema.pool.query("SELECT 1 FROM commerce_payments WHERE order_id=$1", [created.order.id])).rowCount, 0);
  assert.equal((await schema.pool.query("SELECT 1 FROM commerce_order_agreements WHERE order_id=$1", [created.order.id])).rowCount, 0);
  // Readable by id and by Idempotency-Key.
  assert.deepEqual(await partnerOrders.getPartnerOrder("bakimx", created.order.id), created.order);
  assert.deepEqual(await partnerOrders.getPartnerOrderByKey("bakimx", key), created.order);
});

test("Idempotency-Key: the same body replays the order without a supplier call; another body is a conflict", async () => {
  const { body } = await quoteAndBody([{ code: "PART-A", quantity: 1 }]);
  const key = randomUUID();
  const first = await partnerOrders.createPartnerOrder("bakimx", key, body, config());
  const count = await orderCount();
  supplierCalls = 0;
  // A replay works even after the quote expired and with ordering switched off: the order already exists.
  const again = await partnerOrders.createPartnerOrder("bakimx", key, body, config({ limitKurus: null, now: () => Date.now() + 60 * 60_000 }));
  assert.deepEqual([again.replayed, again.order.id], [true, first.order.id]);
  assert.equal(supplierCalls, 0);
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", key, { ...body, note: "Başka" }, config()), refusal("IDEMPOTENCY_CONFLICT"));
  assert.equal(await orderCount(), count);
  // Two requests with the same key at once create one order.
  const { body: twin } = await quoteAndBody([{ code: "PART-B", quantity: 1 }]);
  const twinKey = randomUUID();
  const [left, right] = await Promise.all([partnerOrders.createPartnerOrder("bakimx", twinKey, twin, config()), partnerOrders.createPartnerOrder("bakimx", twinKey, twin, config())]);
  assert.equal(left.order.id, right.order.id);
  assert.deepEqual([left.replayed, right.replayed].sort(), [false, true]);
});

test("a price that moved since the quote is refused with the new price; the partner re-quotes", async () => {
  const { body } = await quoteAndBody([{ code: "PART-A", quantity: 1 }, { code: "PART-B", quantity: 1 }]);
  prices["PART-A"] = 110;
  const count = await orderCount();
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", randomUUID(), body, config()), refusal("PRICE_CHANGED", details => {
    assert.deepEqual(details?.lines, [{ selectedOfferId: offers["PART-A"], expectedUnitNetKurus: 13000, unitNetKurus: 14300 }]);
  }));
  assert.equal(await orderCount(), count);
  const { quote, body: fresh } = await quoteAndBody([{ code: "PART-A", quantity: 1 }]);
  assert.equal(quote.lines[0].unitNetKurus, 14300);
  assert.ok((await partnerOrders.createPartnerOrder("bakimx", randomUUID(), fresh, config())).order.id);
});

test("an expired or foreign quote is refused before any supplier call", async () => {
  const { body } = await quoteAndBody([{ code: "PART-A", quantity: 1 }]);
  supplierCalls = 0;
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", randomUUID(), body, config({ now: () => Date.now() + 16 * 60_000 })), refusal("QUOTE_EXPIRED"));
  // Another partner cannot use BakımX's quote; a changed line does not match the signed one.
  await assert.rejects(partnerOrders.createPartnerOrder("other", randomUUID(), body, config()), refusal("QUOTE_CHANGED"));
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", randomUUID(), { ...body, lines: [{ ...body.lines[0], expectedUnitNetKurus: 1 }] }, config()), refusal("QUOTE_CHANGED"));
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", randomUUID(), body, config({ secret: undefined })), refusal("QUOTE_CONFIGURATION_UNAVAILABLE"));
  await assert.rejects(partnerOrders.quotePartnerOrder("bakimx", { lines: [{ selectedOfferId: offers["PART-A"], quantity: 1 }] }, config({ secret: "" })), refusal("QUOTE_CONFIGURATION_UNAVAILABLE"));
  assert.equal(supplierCalls, 0);
});

test("unknown offers, and codes the supplier no longer knows at order time, are named as unavailable", async () => {
  const unknown = dto.encodeOfferId(randomUUID());
  await assert.rejects(partnerOrders.quotePartnerOrder("bakimx", { lines: [{ selectedOfferId: offers["PART-A"], quantity: 1 }, { selectedOfferId: unknown, quantity: 1 }] }, config()),
    refusal("OFFER_UNAVAILABLE", details => assert.deepEqual(details?.selectedOfferIds, [unknown])));
  const { body } = await quoteAndBody([{ code: "PART-A", quantity: 1 }, { code: "PART-B", quantity: 1 }]);
  gone.add("PART-B");
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", randomUUID(), body, config()), refusal("OFFER_UNAVAILABLE", details => {
    assert.deepEqual(details?.selectedOfferIds, [offers["PART-B"]]);
  }));
});

test("orders and keys are tenant-scoped", async () => {
  const { body } = await quoteAndBody([{ code: "PART-A", quantity: 1 }]);
  const key = randomUUID();
  const { order } = await partnerOrders.createPartnerOrder("bakimx", key, body, config());
  await assert.rejects(partnerOrders.getPartnerOrder("other", order.id), refusal("ORDER_NOT_FOUND"));
  await assert.rejects(partnerOrders.getPartnerOrderByKey("other", key), refusal("ORDER_NOT_FOUND"));
  await assert.rejects(partnerOrders.getPartnerOrder("bakimx", "not-a-uuid"), refusal("ORDER_NOT_FOUND"));
  // Store orders are never visible to a partner.
  const store = (await schema.pool.query<{ id: string }>(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,customer_name,email,phone,address,total_kurus,subtotal_kurus,discount_percent,status,payment_status)
    VALUES('account',$1,$2,'Müşteri','m@example.invalid','5551234567','Adres',1000,1000,0,'pending','paid') RETURNING id::text`, [randomUUID(), randomUUID()])).rows[0];
  await assert.rejects(partnerOrders.getPartnerOrder("bakimx", store.id), refusal("ORDER_NOT_FOUND"));
  // The same Idempotency-Key used by another partner is its own order, not a conflict.
  const { body: otherBody } = await quoteAndBody([{ code: "PART-B", quantity: 1 }], "other");
  const other = await partnerOrders.createPartnerOrder("other", key, otherBody, config());
  assert.notEqual(other.order.id, order.id);
  assert.equal(other.replayed, false);
});

test("the open-order limit counts the partner's undelivered, uncancelled orders and fails closed without a limit", async () => {
  const one = await quoteAndBody([{ code: "PART-A", quantity: 1 }]);
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", randomUUID(), one.body, config({ limitKurus: null })), refusal("ORDER_LIMIT_UNAVAILABLE"));
  // 156.00 TL of goods + 50.00 TL shipping = 206.00 TL per order: a 450.00 TL limit takes two.
  const limit = config({ limitKurus: 45_000 });
  const first = await partnerOrders.createPartnerOrder("bakimx", randomUUID(), one.body, limit);
  const second = await partnerOrders.createPartnerOrder("bakimx", randomUUID(), (await quoteAndBody([{ code: "PART-B", quantity: 1 }])).body, limit);
  const third = (await quoteAndBody([{ code: "PART-A", quantity: 1 }])).body;
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", randomUUID(), third, limit), refusal("CREDIT_LIMIT_EXCEEDED", details => {
    assert.deepEqual(details, { limitKurus: 45_000, openKurus: 41_200, orderKurus: 20_600 });
  }));
  // Another partner's orders do not count; a cancelled or delivered order frees its amount.
  assert.ok((await partnerOrders.createPartnerOrder("other", randomUUID(), (await quoteAndBody([{ code: "PART-A", quantity: 2 }], "other")).body, limit)).order.id);
  assert.equal(await adminOrders.transitionOrder(first.order.id, "cancelled"), true);
  await schema.pool.query("UPDATE commerce_orders SET status='delivered' WHERE id=$1", [second.order.id]);
  assert.ok((await partnerOrders.createPartnerOrder("bakimx", randomUUID(), third, limit)).order.id);
});

test("on-account orders stay out of the payment window and operations handle them like paid ones", async () => {
  const { body } = await quoteAndBody([{ code: "PART-A", quantity: 1 }]);
  const { order } = await partnerOrders.createPartnerOrder("bakimx", randomUUID(), body, config());
  // Even with a past due date the payment sweep and its expiry leave it alone.
  await schema.pool.query("UPDATE commerce_orders SET payment_due_at=now()-interval '1 day' WHERE id=$1", [order.id]);
  await checkout.reconcilePendingPayments(100);
  let row = await orderRow(order.id);
  assert.deepEqual([row.status, row.payment_status, row.cancelled_by], ["pending", "on_account", null]);
  // Confirm and ship from /yonetim; the partner sees the new status.
  assert.equal(await adminOrders.transitionOrder(order.id, "confirmed"), true);
  assert.equal(await adminOrders.shipOrder(order.id, { carrier: "yurtici", carrierName: null, trackingNo: "123456789012", trackingUrl: null }), true);
  const shipped = await partnerOrders.getPartnerOrder("bakimx", order.id);
  assert.deepEqual([shipped.status, shipped.shipment?.trackingNo], ["SHIPPED", "123456789012"]);
  // A cancelled on-account order owes nothing: no refund state.
  const { body: next } = await quoteAndBody([{ code: "PART-B", quantity: 1 }]);
  const cancelled = await partnerOrders.createPartnerOrder("bakimx", randomUUID(), next, config());
  assert.equal(await adminOrders.transitionOrder(cancelled.order.id, "cancelled"), true);
  row = await orderRow(cancelled.order.id);
  assert.deepEqual([row.status, row.payment_status, row.cancelled_by], ["cancelled", "on_account", "admin"]);
  const dtoAfter = await partnerOrders.getPartnerOrder("bakimx", cancelled.order.id);
  assert.deepEqual([dtoAfter.status, dtoAfter.cancelledBy], ["CANCELLED", "GETIRBAKIM"]);
});

test("an unreachable supplier does not block the order: the line is sold on fresh saved data and marked for operations (#763)", async () => {
  const { body } = await quoteAndBody([{ code: "PART-A", quantity: 1 }]);
  liveDown = true;
  const { order } = await partnerOrders.createPartnerOrder("bakimx", randomUUID(), body, config());
  const line = (await schema.pool.query("SELECT pricing_snapshot FROM commerce_order_items WHERE order_id=$1", [order.id])).rows[0];
  assert.deepEqual([line.pricing_snapshot.live_check, line.pricing_snapshot.checkout_mode], ["failed", "snapshot"]);
  // Snapshot mode (Başbuğ policy off): no live call at all, the same rule as the storefront.
  liveDown = false; supplierCalls = 0;
  await schema.pool.query("UPDATE commerce_settings SET basbug_checkout_mode='snapshot'");
  const { body: saved } = await quoteAndBody([{ code: "PART-B", quantity: 1 }]);
  assert.ok((await partnerOrders.createPartnerOrder("bakimx", randomUUID(), saved, config())).order.id);
  assert.equal(supplierCalls, 0);
});

test("shipping follows the store's rule, is bound by the quote and stored on the order", async () => {
  const { quote, body } = await quoteAndBody([{ code: "PART-A", quantity: 1 }]);
  assert.deepEqual(quote.totals, { netKurus: 13000, vatKurus: 2600, shippingKurus: 5000, grossKurus: 20600 });
  const { order } = await partnerOrders.createPartnerOrder("bakimx", randomUUID(), body, config());
  assert.deepEqual(order.totals, quote.totals);
  const row = await orderRow(order.id);
  assert.deepEqual([Number(row.subtotal_kurus), Number(row.shipping_kurus), Number(row.total_kurus)], [15600, 5000, 20600]);
  // A shipping fee changed after the quote is a changed price, with the new fee.
  const { body: next } = await quoteAndBody([{ code: "PART-B", quantity: 1 }]);
  await schema.pool.query("UPDATE commerce_settings SET shipping_fee_kurus=7500");
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", randomUUID(), next, config()), refusal("PRICE_CHANGED", details => {
    assert.deepEqual(details, { lines: [], shipping: { expectedShippingKurus: 5000, shippingKurus: 7500 } });
  }));
});

test("two orders with different keys at once cannot both pass a limit they exceed together", async () => {
  const left = await quoteAndBody([{ code: "PART-A", quantity: 1 }]);
  const right = await quoteAndBody([{ code: "PART-B", quantity: 1 }]);
  // 206.00 TL each: one fits a 300.00 TL limit, both do not.
  const results = await Promise.allSettled([
    partnerOrders.createPartnerOrder("bakimx", randomUUID(), left.body, config({ limitKurus: 30_000 })),
    partnerOrders.createPartnerOrder("bakimx", randomUUID(), right.body, config({ limitKurus: 30_000 })),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected");
  assert.ok(rejected && refusal("CREDIT_LIMIT_EXCEEDED")(rejected.reason));
});

test("route handlers: key, Idempotency-Key and body checks, 201 then 200 replay, tenant-scoped reads", async () => {
  const [{ NextRequest }, quoteRoute, ordersRoute, orderRoute, byKeyRoute] = await Promise.all([import("next/server"),
    import("../src/app/api/partner/v1/order-quotes/route"), import("../src/app/api/partner/v1/orders/route"),
    import("../src/app/api/partner/v1/orders/[id]/route"), import("../src/app/api/partner/v1/orders/by-key/[key]/route")]);
  const auth = { authorization: `Bearer ${"k".repeat(24)}` };
  const base = "https://getirbakim.com/api/partner/v1";
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    new NextRequest(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const get = (path: string, headers: Record<string, string> = auth) => new NextRequest(`${base}${path}`, { headers });
  const errorCode = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;

  // No key or a wrong key: 401 before anything else.
  let response = await ordersRoute.POST(post("/orders", {}, { "idempotency-key": randomUUID() }));
  assert.deepEqual([response.status, await errorCode(response)], [401, "UNAUTHORIZED"]);
  response = await quoteRoute.POST(post("/order-quotes", {}, { authorization: "Bearer wrong-key-wrong-key-x" }));
  assert.equal(response.status, 401);

  response = await quoteRoute.POST(post("/order-quotes", { lines: [{ selectedOfferId: offers["PART-A"], quantity: 1 }] }, auth));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const { quote } = await response.json() as { quote: { confirmationToken: string; lines: { selectedOfferId: string; quantity: number; unitNetKurus: number }[] } };
  // The wire form: optional fields left out, a free-form phone.
  const shippingAddress = { recipientName: "Usta Oto Servis", phone: "0532 000 00 00", province: "istanbul", district: "Kadıköy", addressLine: "Test Mahallesi 1. Sokak No 2" };
  const body = { confirmationToken: quote.confirmationToken, shippingAddress,
    lines: quote.lines.map(line => ({ selectedOfferId: line.selectedOfferId, quantity: line.quantity, expectedUnitNetKurus: line.unitNetKurus })) };

  // A missing or malformed Idempotency-Key, or a body that is not the contract, is 400.
  for (const headers of [auth, { ...auth, "idempotency-key": "not-a-uuid" }]) {
    response = await ordersRoute.POST(post("/orders", body, headers));
    assert.deepEqual([response.status, await errorCode(response)], [400, "VALIDATION_ERROR"]);
  }
  const key = randomUUID();
  for (const invalid of ["{not json", { ...body, partner: "other" }, { ...body, lines: [] }]) {
    response = await ordersRoute.POST(post("/orders", invalid, { ...auth, "idempotency-key": key }));
    assert.deepEqual([response.status, await errorCode(response)], [400, "VALIDATION_ERROR"]);
  }

  response = await ordersRoute.POST(post("/orders", body, { ...auth, "idempotency-key": key }));
  assert.equal(response.status, 201);
  const created = await response.json() as { order: { id: string }; replayed: boolean };
  assert.equal(created.replayed, false);
  response = await ordersRoute.POST(post("/orders", body, { ...auth, "idempotency-key": key.toUpperCase() }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...created, replayed: true });
  response = await ordersRoute.POST(post("/orders", { ...body, note: "Başka" }, { ...auth, "idempotency-key": key }));
  assert.deepEqual([response.status, await errorCode(response)], [409, "IDEMPOTENCY_CONFLICT"]);

  response = await orderRoute.GET(get(`/orders/${created.order.id}`), { params: Promise.resolve({ id: created.order.id }) });
  assert.deepEqual([response.status, ((await response.json()) as { order: { id: string } }).order.id], [200, created.order.id]);
  response = await byKeyRoute.GET(get(`/orders/by-key/${key}`), { params: Promise.resolve({ key }) });
  assert.equal(response.status, 200);
  response = await orderRoute.GET(get(`/orders/${randomUUID()}`), { params: Promise.resolve({ id: randomUUID() }) });
  assert.deepEqual([response.status, await errorCode(response)], [404, "ORDER_NOT_FOUND"]);
  response = await orderRoute.GET(get(`/orders/${created.order.id}`, {}), { params: Promise.resolve({ id: created.order.id }) });
  assert.equal(response.status, 401);
});
