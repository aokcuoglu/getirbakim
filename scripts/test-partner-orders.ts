import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { lineAmounts } from "../src/modules/partner/order-dto";
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
let partnerCancel: typeof import("../src/modules/partner/order-cancel");
let partnerReturns: typeof import("../src/modules/partner/returns");
let adminData: typeof import("../src/modules/admin/order-filters");
let limits: typeof import("../src/modules/partner/limits");
let intake: typeof import("../src/modules/partner/intake");
let discounts: typeof import("../src/modules/partner/discounts");
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
// Runs once at the next supplier request: something that happens while the order waits for the live check.
let onSupplierCall: (() => Promise<unknown>) | null = null;
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
    const hook = onSupplierCall;
    onSupplierCall = null;
    await hook?.();
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
  const [{ db }, basbug, ordersModule, quotesModule, dtoModule, adminModule, checkoutModule, cancelModule, dataModule] = await Promise.all([import("../src/lib/db"),
    import("../src/modules/suppliers/basbug-import"), import("../src/modules/partner/orders"), import("../src/modules/partner/quotes"),
    import("../src/modules/partner/dto"), import("../src/modules/admin/orders"), import("../src/modules/payments/checkout"),
    import("../src/modules/partner/order-cancel"), import("../src/modules/admin/order-filters")]);
  limits = await import("../src/modules/partner/limits");
  intake = await import("../src/modules/partner/intake");
  discounts = await import("../src/modules/partner/discounts");
  partnerReturns = await import("../src/modules/partner/returns");
  partnerOrders = ordersModule; quotes = quotesModule; dto = dtoModule; adminOrders = adminModule; checkout = checkoutModule;
  partnerCancel = cancelModule; adminData = dataModule;
  closeDb = () => db.end();
  await basbug.importBasbug(db, { group: "FIAT", warehouse: "MRK", company: "TEST" });
  // A live check saves what the supplier said: each test starts from the mock's list again.
  reimport = () => basbug.importBasbug(db, { group: "FIAT", warehouse: "MRK", company: "TEST", mode: "commerce" });
  for (const row of (await schema.pool.query<{ id: string; code: string }>("SELECT id::text,code FROM supplier_items")).rows) offers[row.code] = dto.encodeOfferId(row.id);
  assert.deepEqual(Object.keys(offers).sort(), codes);
});
beforeEach(async () => {
  for (const code of codes) { prices[code] = 100; stocks[code] = 5; }
  gone.clear(); liveDown = false; onSupplierCall = null;
  await reimport();
  supplierCalls = 0;
  // Each test starts without open or uninvoiced partner orders and without panel limits, so the limit sees only its own.
  await schema.pool.query("UPDATE commerce_orders SET status='delivered',partner_invoiced_at=COALESCE(partner_invoiced_at,now()) WHERE owner_kind='partner'");
  await schema.pool.query("DELETE FROM partner_settings");
  await schema.pool.query("DELETE FROM partner_discount_changes");
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

test("the open-order limit counts open and delivered-uninvoiced orders and fails closed without a limit", async () => {
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
  // Another partner's orders do not count; a delivered order still does until it is invoiced.
  assert.ok((await partnerOrders.createPartnerOrder("other", randomUUID(), (await quoteAndBody([{ code: "PART-A", quantity: 2 }], "other")).body, limit)).order.id);
  await schema.pool.query("UPDATE commerce_orders SET status='delivered',delivered_at=now() WHERE id=$1", [second.order.id]);
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", randomUUID(), third, limit), refusal("CREDIT_LIMIT_EXCEEDED", details => {
    assert.deepEqual(details, { limitKurus: 45_000, openKurus: 41_200, orderKurus: 20_600 });
  }));
  assert.deepEqual(await limits.partnerExposure("bakimx"), { openKurus: 20_600, openCount: 1, uninvoicedKurus: 20_600, uninvoicedCount: 1, exposureKurus: 41_200 });
  // A cancelled order frees its amount.
  assert.equal(await adminOrders.transitionOrder(first.order.id, "cancelled"), true);
  assert.ok((await partnerOrders.createPartnerOrder("bakimx", randomUUID(), third, limit)).order.id);
});

test("a /yonetim limit overrides the fallback; clearing it falls back; with neither the partner cannot order", async () => {
  const { body } = await quoteAndBody([{ code: "PART-A", quantity: 1 }]);
  // 206.00 TL does not fit a 200.00 TL panel limit, even with a large fallback.
  await limits.savePartnerOrderLimit("bakimx", 20_000, null);
  assert.deepEqual(await limits.partnerOrderLimit("bakimx", 10_000_000), { limitKurus: 20_000, source: "panel" });
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", randomUUID(), body, config()), refusal("CREDIT_LIMIT_EXCEEDED", details => {
    assert.equal(details?.limitKurus, 20_000);
  }));
  // The panel value alone opens ordering when the deployment has no fallback.
  await limits.savePartnerOrderLimit("bakimx", 30_000, null);
  assert.ok((await partnerOrders.createPartnerOrder("bakimx", randomUUID(), body, config({ limitKurus: null }))).order.id);
  // Cleared: the fallback applies again; without it ordering is closed before any supplier call.
  await limits.savePartnerOrderLimit("bakimx", null, null);
  assert.deepEqual(await limits.partnerOrderLimit("bakimx", null), { limitKurus: null, source: "none" });
  assert.deepEqual(await limits.partnerOrderLimit("bakimx", 5_000), { limitKurus: 5_000, source: "env" });
  const { body: next } = await quoteAndBody([{ code: "PART-B", quantity: 1 }]);
  supplierCalls = 0;
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", randomUUID(), next, config({ limitKurus: null })), refusal("ORDER_LIMIT_UNAVAILABLE"));
  assert.equal(supplierCalls, 0);
  // Another partner's panel limit is its own.
  await limits.savePartnerOrderLimit("other", 20_000, null);
  assert.deepEqual(await limits.partnerOrderLimit("bakimx", null), { limitKurus: null, source: "none" });
});

test("a /yonetim discount (#1130) prices quotes and orders at once, falls back when cleared and never goes below cost", async () => {
  const unit = async (partner = "bakimx", cfg = config()) => (await quoteAndBody([{ code: "PART-A", quantity: 1 }], partner, cfg)).quote.lines[0].unitNetKurus;
  const fallback = config({ discountBps: 500 });
  // 130.00 TL before VAT; the deployment fallback (PARTNER_B2B_DISCOUNT_BPS) takes 5%.
  assert.equal(await unit("bakimx", fallback), 12_350);
  const before = await quoteAndBody([{ code: "PART-A", quantity: 1 }], "bakimx", fallback);
  await discounts.savePartnerDiscount("bakimx", 1000, null);
  assert.deepEqual(await discounts.partnerDiscount("bakimx", 500), { discountBps: 1000, source: "panel" });
  assert.equal(await unit("bakimx", fallback), 11_700);
  // A quote made before the change is refused at order time with the new price, nothing is written.
  const count = await orderCount();
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", randomUUID(), before.body, fallback), refusal("PRICE_CHANGED", details => {
    assert.deepEqual(details?.lines, [{ selectedOfferId: offers["PART-A"], expectedUnitNetKurus: 12_350, unitNetKurus: 11_700 }]);
  }));
  assert.equal(await orderCount(), count);
  const { order } = await partnerOrders.createPartnerOrder("bakimx", randomUUID(), (await quoteAndBody([{ code: "PART-A", quantity: 1 }], "bakimx", fallback)).body, fallback);
  const snapshot = (await schema.pool.query("SELECT pricing_snapshot FROM commerce_order_items WHERE order_id=$1", [order.id])).rows[0].pricing_snapshot;
  assert.deepEqual([snapshot.partner.unit_net_kurus, snapshot.partner.discount_bps], [11_700, 1000]);
  // Another partner keeps the fallback.
  assert.equal(await unit("other", fallback), 12_350);
  // 0 on the panel overrides the fallback: no discount.
  await discounts.savePartnerDiscount("bakimx", 0, null);
  assert.equal(await unit("bakimx", fallback), 13_000);
  // 50% would be 65.00 TL, below the 100.00 TL cost: floored at cost.
  await discounts.savePartnerDiscount("bakimx", 5000, null);
  assert.equal(await unit("bakimx", fallback), 10_000);
  // Cleared: the fallback, then none.
  await discounts.savePartnerDiscount("bakimx", null, null);
  assert.equal(await unit("bakimx", fallback), 12_350);
  assert.deepEqual(await discounts.partnerDiscount("bakimx", 0), { discountBps: 0, source: "none" });
  assert.equal(await unit("bakimx", config()), 13_000);
  // Every change is recorded with the old and new value; saving the same value again records nothing.
  assert.deepEqual(await discounts.savePartnerDiscount("bakimx", null, null), { changed: false });
  const history = (await schema.pool.query<{ old_discount_bps: number | null; new_discount_bps: number | null }>(
    "SELECT old_discount_bps,new_discount_bps FROM partner_discount_changes WHERE partner_code='bakimx' ORDER BY id")).rows;
  assert.deepEqual(history.map(row => [row.old_discount_bps, row.new_discount_bps]), [[null, 1000], [1000, 0], [0, 5000], [5000, null]]);
  assert.deepEqual((await discounts.lastDiscountChanges(["bakimx", "other"])).get("bakimx")?.newBps, null);
  assert.equal((await discounts.lastDiscountChanges(["other"])).size, 0);
  // Clearing a partner without a row creates none.
  await discounts.savePartnerDiscount("nobody", null, null);
  assert.equal((await schema.pool.query("SELECT 1 FROM partner_settings WHERE partner_code='nobody'")).rowCount, 0);
});

test("the products endpoint's discount cache (#1130) serves a saved change at once in this process", async () => {
  assert.deepEqual(await discounts.cachedPartnerDiscount("bakimx", 500), { discountBps: 500, source: "env" });
  // A write behind the panel's back stays cached ...
  await schema.pool.query("INSERT INTO partner_settings(partner_code,discount_bps) VALUES('bakimx',700)");
  assert.deepEqual(await discounts.cachedPartnerDiscount("bakimx", 500), { discountBps: 500, source: "env" });
  // ... a panel save drops it.
  await discounts.savePartnerDiscount("bakimx", 1200, null);
  assert.deepEqual(await discounts.cachedPartnerDiscount("bakimx", 500), { discountBps: 1200, source: "panel" });
  await discounts.savePartnerDiscount("bakimx", null, null);
  assert.deepEqual(await discounts.cachedPartnerDiscount("bakimx", 0), { discountBps: 0, source: "none" });
  // The column refuses more than 90%.
  await assert.rejects(schema.pool.query("UPDATE partner_settings SET discount_bps=9001 WHERE partner_code='bakimx'"), /check/i);
});

test("a paused partner (#1009) gets no quote and no new order; others, reads and replays keep working; resume reopens", async () => {
  const { body } = await quoteAndBody([{ code: "PART-A", quantity: 1 }]);
  const key = randomUUID();
  const earlier = await partnerOrders.createPartnerOrder("bakimx", key, body, config());
  const { body: pending } = await quoteAndBody([{ code: "PART-B", quantity: 1 }]);
  await intake.setPartnerIntakePaused("bakimx", true, null);
  assert.deepEqual([...(await intake.pausedPartners(["bakimx", "other"])).keys()], ["bakimx"]);
  const count = await orderCount();
  supplierCalls = 0;
  await assert.rejects(partnerOrders.quotePartnerOrder("bakimx", { lines: [{ selectedOfferId: offers["PART-A"], quantity: 1 }] }, config()), refusal("ORDER_INTAKE_PAUSED"));
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", randomUUID(), pending, config()), (error: unknown) =>
    refusal("ORDER_INTAKE_PAUSED")(error) && error instanceof quotes.PartnerOrderError && error.status === 503 && error.details === undefined);
  // Paused wins over a missing limit: the partner is told the real reason.
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", randomUUID(), pending, config({ limitKurus: null })), refusal("ORDER_INTAKE_PAUSED"));
  assert.equal(await orderCount(), count);
  assert.equal(supplierCalls, 0);
  // An order created before the pause still replays and reads.
  const again = await partnerOrders.createPartnerOrder("bakimx", key, body, config());
  assert.deepEqual([again.replayed, again.order.id], [true, earlier.order.id]);
  assert.equal((await partnerOrders.getPartnerOrder("bakimx", earlier.order.id)).id, earlier.order.id);
  // Another partner is not affected.
  assert.ok((await placeOrder("PART-A", "other")).id);
  // Resumed: a new key orders again.
  await intake.setPartnerIntakePaused("bakimx", false, null);
  assert.equal((await intake.pausedPartners(["bakimx"])).size, 0);
  assert.equal((await partnerOrders.createPartnerOrder("bakimx", randomUUID(), pending, config())).replayed, false);
});

test("a pause (#1009) that lands during the live supplier check refuses the order under the partner's lock", async () => {
  const { body } = await quoteAndBody([{ code: "PART-A", quantity: 1 }]);
  const key = randomUUID();
  const earlier = await partnerOrders.createPartnerOrder("bakimx", key, body, config());
  const { body: pending } = await quoteAndBody([{ code: "PART-B", quantity: 1 }]);
  const count = await orderCount();
  supplierCalls = 0;
  // The lock-free check passed; the pause lands while the supplier answers, before the order takes the lock.
  onSupplierCall = () => intake.setPartnerIntakePaused("bakimx", true, null);
  const late = randomUUID();
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", late, pending, config()), refusal("ORDER_INTAKE_PAUSED"));
  assert.ok(supplierCalls > 0);
  assert.equal(await orderCount(), count);
  // The earlier key still replays; the late key created nothing, so it is refused again rather than replayed.
  const again = await partnerOrders.createPartnerOrder("bakimx", key, body, config());
  assert.deepEqual([again.replayed, again.order.id], [true, earlier.order.id]);
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", late, pending, config()), refusal("ORDER_INTAKE_PAUSED"));
});

test("the intake switch (#1009) and the panel limit leave each other alone; a second pause keeps the first time", async () => {
  await limits.savePartnerOrderLimit("bakimx", 30_000, null);
  await intake.setPartnerIntakePaused("bakimx", true, null);
  const settings = async () => (await schema.pool.query<{ order_limit_kurus: string | null; order_intake_paused_at: Date | null }>(
    "SELECT order_limit_kurus::text,order_intake_paused_at FROM partner_settings WHERE partner_code='bakimx'")).rows[0];
  const first = (await settings()).order_intake_paused_at;
  assert.ok(first);
  await intake.setPartnerIntakePaused("bakimx", true, null);
  assert.equal((await settings()).order_intake_paused_at?.getTime(), first.getTime());
  // Saving the limit does not reopen intake.
  await limits.savePartnerOrderLimit("bakimx", 40_000, null);
  assert.deepEqual([(await settings()).order_limit_kurus, (await settings()).order_intake_paused_at?.getTime()], ["40000", first.getTime()]);
  await intake.setPartnerIntakePaused("bakimx", false, null);
  assert.deepEqual(await settings(), { order_limit_kurus: "40000", order_intake_paused_at: null });
  assert.deepEqual(await limits.partnerOrderLimit("bakimx", null), { limitKurus: 40_000, source: "panel" });
  // A partner paused without a saved limit gets a row without one.
  await intake.setPartnerIntakePaused("other", true, null);
  assert.deepEqual(await limits.partnerOrderLimit("other", null), { limitKurus: null, source: "none" });
  await intake.setPartnerIntakePaused("other", false, null);
});

test("invoicing releases delivered orders up to a day, once, for one partner only", async () => {
  const deliver = (id: string, at: string) => schema.pool.query("UPDATE commerce_orders SET status='delivered',delivered_at=$2::timestamptz WHERE id=$1", [id, at]);
  // Delivered on 10 and 12 November (Istanbul days; 21:30Z on the 10th is already the 11th in Istanbul).
  const early = await placeOrder("PART-A"), late = await placeOrder("PART-B"), border = await placeOrder("PART-A"), foreign = await placeOrder("PART-A", "other");
  await deliver(early.id, "2026-11-10T10:00:00Z"); await deliver(late.id, "2026-11-12T10:00:00Z");
  await deliver(border.id, "2026-11-10T21:30:00Z"); await deliver(foreign.id, "2026-11-10T10:00:00Z");
  const each = early.totals.grossKurus;
  assert.deepEqual((await limits.uninvoicedDays(["bakimx"])).get("bakimx"), [
    { day: "2026-11-10", count: 1, totalKurus: each }, { day: "2026-11-11", count: 1, totalKurus: each }, { day: "2026-11-12", count: 1, totalKurus: each }]);
  const admin = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved)
    VALUES('Operasyon',$1,'x','admin',true) RETURNING id::text`, [`ops-${randomUUID()}@example.invalid`])).rows[0].id;
  const request = { partner: "bakimx", deliveredUntil: "2026-11-11", invoiceRef: "GBA2026000123", invoiceDate: "2026-11-15", adminId: admin, expected: { count: 2, totalKurus: 2 * each } };
  // What the dialog showed must still hold: a different count or total marks nothing.
  assert.deepEqual(await limits.invoicePartnerOrders({ ...request, expected: { count: 1, totalKurus: each } }), { status: "changed" });
  assert.equal((await limits.partnerExposure("bakimx")).uninvoicedCount, 3);
  assert.deepEqual(await limits.invoicePartnerOrders(request), { status: "invoiced", count: 2, totalKurus: 2 * each });
  const marked = await orderRow(early.id);
  assert.deepEqual([marked.partner_invoice_ref, marked.partner_invoiced_by], ["GBA2026000123", admin]);
  assert.equal((await schema.pool.query("SELECT ($1::timestamptz AT TIME ZONE 'Europe/Istanbul')::text AS at", [marked.partner_invoiced_at])).rows[0].at, "2026-11-15 00:00:00");
  assert.deepEqual(await limits.partnerExposure("bakimx"), { openKurus: 0, openCount: 0, uninvoicedKurus: each, uninvoicedCount: 1, exposureKurus: each });
  // Repeating it marks nothing and keeps the first invoice; the other partner's delivered order is untouched.
  assert.deepEqual(await limits.invoicePartnerOrders({ ...request, invoiceRef: "AGAIN" }), { status: "nothing" });
  assert.equal((await orderRow(early.id)).partner_invoice_ref, "GBA2026000123");
  assert.equal((await orderRow(foreign.id)).partner_invoiced_at, null);
  assert.equal((await orderRow(late.id)).partner_invoiced_at, null);
  // Open (undelivered) orders are never invoiced.
  const open = await placeOrder("PART-B");
  assert.deepEqual(await limits.invoicePartnerOrders({ ...request, deliveredUntil: "2026-11-12", invoiceRef: "NEXT", expected: { count: 1, totalKurus: each } }),
    { status: "invoiced", count: 1, totalKurus: each });
  assert.equal((await orderRow(open.id)).partner_invoiced_at, null);
  assert.deepEqual(await limits.partnerExposure("bakimx"), { openKurus: open.totals.grossKurus, openCount: 1, uninvoicedKurus: 0, uninvoicedCount: 0, exposureKurus: open.totals.grossKurus });
});

const deliverAt = (id: string, at: string) => schema.pool.query("UPDATE commerce_orders SET status='delivered',delivered_at=$2::timestamptz WHERE id=$1", [id, at]);
const opsAccount = async () => (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved)
  VALUES('Operasyon',$1,'x','admin',true) RETURNING id::text`, [`ops-${randomUUID()}@example.invalid`])).rows[0].id;
const changeRows = async (ids: string[]) => (await schema.pool.query("SELECT * FROM partner_invoice_changes WHERE order_id=ANY($1::uuid[]) ORDER BY id", [ids])).rows;

test("undoing an invoiced mark (#1018) counts its orders again and can refuse the next order at the limit", async () => {
  const one = await placeOrder("PART-A"), two = await placeOrder("PART-B");
  await deliverAt(one.id, "2026-11-10T10:00:00Z"); await deliverAt(two.id, "2026-11-10T11:00:00Z");
  const each = one.totals.grossKurus, admin = await opsAccount();
  const invoiceRef = `UNDO-${randomUUID()}`;
  assert.deepEqual(await limits.invoicePartnerOrders({ partner: "bakimx", deliveredUntil: "2026-11-10", invoiceRef, invoiceDate: "2026-11-15", adminId: admin, expected: { count: 2, totalKurus: 2 * each } }),
    { status: "invoiced", count: 2, totalKurus: 2 * each });
  const listed = (await limits.partnerInvoices(["bakimx"])).find(invoice => invoice.invoiceRef === invoiceRef);
  assert.deepEqual(listed, { partner: "bakimx", invoiceRef, invoiceDate: "2026-11-15", count: 2, totalKurus: 2 * each, markedBy: "Operasyon" });
  assert.equal((await limits.partnerExposure("bakimx")).exposureKurus, 0);
  // A 3-order limit takes another order while the two are invoiced...
  const limit = config({ limitKurus: 3 * each });
  const third = (await quoteAndBody([{ code: "PART-A", quantity: 1 }])).body;
  const open = await partnerOrders.createPartnerOrder("bakimx", randomUUID(), third, limit);
  const undo = { partner: "bakimx", invoiceRef, invoiceDate: "2026-11-15", action: "undo" as const, reason: "Yanlış siparişler işaretlendi", adminId: admin, expected: { count: 2, totalKurus: 2 * each } };
  assert.deepEqual(await limits.changePartnerInvoice(undo), { status: "undone", count: 2, totalKurus: 2 * each });
  for (const id of [one.id, two.id]) {
    const row = await orderRow(id);
    assert.deepEqual([row.partner_invoiced_at, row.partner_invoice_ref, row.partner_invoiced_by], [null, null, null]);
  }
  // ...and once they count again, the placed order stays but the next one exceeds the limit.
  assert.deepEqual(await limits.partnerExposure("bakimx"), { openKurus: each, openCount: 1, uninvoicedKurus: 2 * each, uninvoicedCount: 2, exposureKurus: 3 * each });
  assert.equal((await orderRow(open.order.id)).status, "pending");
  await assert.rejects(partnerOrders.createPartnerOrder("bakimx", randomUUID(), (await quoteAndBody([{ code: "PART-B", quantity: 1 }])).body, limit), refusal("CREDIT_LIMIT_EXCEEDED"));
  const audit = await changeRows([one.id, two.id]);
  assert.equal(audit.length, 2);
  assert.equal(new Set(audit.map(row => row.change_id)).size, 1);
  for (const row of audit) {
    assert.deepEqual([row.action, row.partner_code, row.old_invoice_ref, row.old_invoiced_by, row.new_invoice_ref, row.new_invoiced_at, row.reason, row.changed_by],
      ["undo", "bakimx", invoiceRef, admin, null, null, "Yanlış siparişler işaretlendi", admin]);
  }
  const history = (await limits.partnerInvoiceChanges(["bakimx"])).find(change => change.oldRef === invoiceRef);
  assert.deepEqual(history && { ...history, changeId: undefined, changedAt: undefined },
    { changeId: undefined, partner: "bakimx", action: "undo", oldRef: invoiceRef, oldDate: "2026-11-15", newRef: null, newDate: null, reason: "Yanlış siparişler işaretlendi", changedBy: "Operasyon", changedAt: undefined, count: 2 });
  // A resubmitted undo finds nothing and writes nothing.
  assert.deepEqual(await limits.changePartnerInvoice(undo), { status: "nothing" });
  assert.equal((await changeRows([one.id, two.id])).length, 2);
});

test("correcting an invoiced mark (#1018) rewrites number and day, keeps who marked it and the exposure", async () => {
  const one = await placeOrder("PART-A"), foreign = await placeOrder("PART-A", "other");
  await deliverAt(one.id, "2026-11-10T10:00:00Z"); await deliverAt(foreign.id, "2026-11-10T10:00:00Z");
  const each = one.totals.grossKurus, marker = await opsAccount(), fixer = await opsAccount();
  const invoiceRef = `FIX-${randomUUID()}`.slice(0, 40);
  const mark = { deliveredUntil: "2026-11-10", invoiceRef, invoiceDate: "2026-11-15", adminId: marker, expected: { count: 1, totalKurus: each } };
  await limits.invoicePartnerOrders({ ...mark, partner: "bakimx" });
  await limits.invoicePartnerOrders({ ...mark, partner: "other" });
  const before = await limits.partnerExposure("bakimx");
  const correct = { partner: "bakimx", invoiceRef, invoiceDate: "2026-11-15", action: "correct" as const, newInvoiceRef: `${invoiceRef}-2`, newInvoiceDate: "2026-11-16",
    reason: "Fatura no yanlış yazıldı", adminId: fixer, expected: { count: 1, totalKurus: each } };
  // What the dialog showed must still hold; identical values change nothing. Neither writes an audit row.
  assert.deepEqual(await limits.changePartnerInvoice({ ...correct, expected: { count: 2, totalKurus: each } }), { status: "changed" });
  assert.deepEqual(await limits.changePartnerInvoice({ ...correct, expected: { count: 1, totalKurus: each + 1 } }), { status: "changed" });
  assert.deepEqual(await limits.changePartnerInvoice({ ...correct, newInvoiceRef: invoiceRef, newInvoiceDate: "2026-11-15" }), { status: "same" });
  // The wrong day names no invoice.
  assert.deepEqual(await limits.changePartnerInvoice({ ...correct, invoiceDate: "2026-11-14" }), { status: "nothing" });
  assert.equal((await changeRows([one.id, foreign.id])).length, 0);
  assert.deepEqual(await limits.changePartnerInvoice(correct), { status: "corrected", count: 1, totalKurus: each });
  const row = await orderRow(one.id);
  assert.deepEqual([row.partner_invoice_ref, row.partner_invoiced_by], [`${invoiceRef}-2`, marker]);
  assert.equal((await schema.pool.query("SELECT ($1::timestamptz AT TIME ZONE 'Europe/Istanbul')::text AS at", [row.partner_invoiced_at])).rows[0].at, "2026-11-16 00:00:00");
  assert.deepEqual(await limits.partnerExposure("bakimx"), before);
  // The other partner's invoice with the same number is untouched.
  assert.equal((await orderRow(foreign.id)).partner_invoice_ref, invoiceRef);
  const [audit] = await changeRows([one.id, foreign.id]);
  assert.deepEqual([audit.action, audit.order_id, audit.old_invoice_ref, audit.old_invoiced_by, audit.new_invoice_ref, audit.changed_by],
    ["correct", one.id, invoiceRef, marker, `${invoiceRef}-2`, fixer]);
  assert.equal((await schema.pool.query("SELECT ($1::timestamptz AT TIME ZONE 'Europe/Istanbul')::text AS old,($2::timestamptz AT TIME ZONE 'Europe/Istanbul')::text AS new",
    [audit.old_invoiced_at, audit.new_invoiced_at])).rows.map(r => `${r.old}→${r.new}`)[0], "2026-11-15 00:00:00→2026-11-16 00:00:00");
  const history = (await limits.partnerInvoiceChanges(["bakimx", "other"])).find(change => change.oldRef === invoiceRef);
  assert.deepEqual(history && [history.partner, history.action, history.oldDate, history.newRef, history.newDate, history.count], ["bakimx", "correct", "2026-11-15", `${invoiceRef}-2`, "2026-11-16", 1]);
  assert.equal((await limits.partnerInvoices(["bakimx"])).some(invoice => invoice.invoiceRef === invoiceRef), false);
  // A short reason is refused by the table too.
  await assert.rejects(schema.pool.query(`INSERT INTO partner_invoice_changes(change_id,order_id,partner_code,action,old_invoice_ref,old_invoiced_at,reason)
    VALUES(gen_random_uuid(),$1,'bakimx','undo','X',now(),' abc ')`, [one.id]), (error: { code?: string }) => error.code === "23514");
});

test("a correction (#1018) never merges two invoices and waits for the partner's order lock", async () => {
  const one = await placeOrder("PART-A"), two = await placeOrder("PART-B");
  await deliverAt(one.id, "2026-11-10T10:00:00Z"); await deliverAt(two.id, "2026-11-11T10:00:00Z");
  const each = one.totals.grossKurus, admin = await opsAccount();
  const first = `M1-${randomUUID()}`, second = `M2-${randomUUID()}`;
  const mark = { partner: "bakimx", invoiceDate: "2026-11-15", adminId: admin, expected: { count: 1, totalKurus: each } };
  await limits.invoicePartnerOrders({ ...mark, deliveredUntil: "2026-11-10", invoiceRef: first });
  await limits.invoicePartnerOrders({ ...mark, deliveredUntil: "2026-11-11", invoiceRef: second });
  const correct = { partner: "bakimx", invoiceRef: second, invoiceDate: "2026-11-15", action: "correct" as const, newInvoiceRef: first, newInvoiceDate: "2026-11-15",
    reason: "Numara yanlış yazıldı", adminId: admin, expected: { count: 1, totalKurus: each } };
  // The first invoice already has that number and day: nothing is written.
  assert.deepEqual(await limits.changePartnerInvoice(correct), { status: "merge" });
  assert.equal((await orderRow(two.id)).partner_invoice_ref, second);
  assert.equal((await changeRows([one.id, two.id])).length, 0);
  // Another day with the same number is a different invoice.
  const holder = await schema.pool.connect();
  try {
    await holder.query("BEGIN");
    await limits.lockPartnerOrders(holder, "bakimx");
    let settled = false;
    const pending = limits.changePartnerInvoice({ ...correct, newInvoiceDate: "2026-11-16" }).finally(() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(settled, false, "the change ran while the partner's order lock was held");
    await holder.query("COMMIT");
    assert.deepEqual(await pending, { status: "corrected", count: 1, totalKurus: each });
  } finally {
    await holder.query("ROLLBACK").catch(() => undefined);
    holder.release();
  }
  assert.equal((await orderRow(two.id)).partner_invoice_ref, first);
  assert.equal((await orderRow(one.id)).partner_invoice_ref, first);
});

test("admin partner input: TL limits become kuruş, dates are past Istanbul days, usage tones follow the limit", async () => {
  const { partnerLimitInput, partnerInvoiceInput, partnerInvoiceChangeInput, partnerIntakeInput, partnerDiscountInput, percentText, istanbulToday, limitUsage } = await import("../src/modules/admin/partner-input");
  const discount = (value: string) => partnerDiscountInput.safeParse({ partner: "bakimx", discount: value });
  assert.equal(discount("10").data?.discount, 1000);
  assert.equal(discount(" 12,5 ").data?.discount, 1250);
  assert.equal(discount("%7.25").data?.discount, 725);
  assert.equal(discount("90").data?.discount, 9000);
  assert.equal(discount("0").data?.discount, 0);
  assert.equal(discount("").data?.discount, null);
  for (const bad of ["90,01", "100", "-5", "abc", "1,234", "5.5.5"]) assert.equal(discount(bad).success, false, bad);
  assert.deepEqual([percentText(1000), percentText(1250), percentText(725), percentText(0)], ["10", "12,5", "7,25", "0"]);
  assert.deepEqual(partnerIntakeInput.safeParse({ partner: " bakimx ", paused: "1" }).data, { partner: "bakimx", paused: true });
  assert.deepEqual(partnerIntakeInput.safeParse({ partner: "bakimx", paused: "0" }).data, { partner: "bakimx", paused: false });
  for (const bad of [{ partner: "bakimx", paused: "true" }, { partner: "bakimx", paused: "" }, { partner: "bakimx" }, { partner: " ", paused: "1" }, { paused: "1" }]) {
    assert.equal(partnerIntakeInput.safeParse(bad).success, false, JSON.stringify(bad));
  }
  const limit = (value: string) => partnerLimitInput.safeParse({ partner: "bakimx", limit: value });
  assert.equal(limit("4500").data?.limit, 450_000);
  assert.equal(limit(" 4500,5 ").data?.limit, 450_050);
  assert.equal(limit("4500.05").data?.limit, 450_005);
  assert.equal(limit("").data?.limit, null);
  for (const bad of ["0", "-5", "4.500,00", "12.345", "abc"]) assert.equal(limit(bad).success, false, bad);
  const now = new Date("2026-11-19T22:30:00Z");
  assert.equal(istanbulToday(now), "2026-11-20");
  const invoice = (values: Partial<Record<string, string>>) => partnerInvoiceInput(now).safeParse({
    partner: "bakimx", deliveredUntil: "2026-11-20", invoiceRef: "GBA1", invoiceDate: "2026-11-20", expectedCount: "1", expectedTotal: "100", ...values });
  assert.equal(invoice({}).success, true);
  for (const bad of [{ deliveredUntil: "2026-11-21" }, { invoiceDate: "2026-02-30" }, { invoiceDate: "2026-13-45" }, { invoiceRef: " " }, { expectedCount: "0" }]) assert.equal(invoice(bad).success, false, JSON.stringify(bad));
  const change = (values: Partial<Record<string, string>>) => partnerInvoiceChangeInput(now).safeParse({
    partner: "bakimx", invoiceRef: "GBA1", invoiceDate: "2026-11-15", action: "correct", newInvoiceRef: " GBA2 ", newInvoiceDate: "2026-11-20",
    reason: "  Fatura no yanlış  ", expectedCount: "1", expectedTotal: "100", ...values });
  const parsed = change({});
  assert.deepEqual(parsed.success && parsed.data.action === "correct" && [parsed.data.newInvoiceRef, parsed.data.reason], ["GBA2", "Fatura no yanlış"]);
  assert.equal(change({ action: "undo", newInvoiceRef: undefined, newInvoiceDate: undefined }).success, true);
  const reasonError = change({ reason: " abcd " });
  assert.deepEqual(!reasonError.success && reasonError.error.flatten().fieldErrors.reason, ["Gerekçeyi yazın (en az 5 karakter)."]);
  // Code points, like the table's CHECK: four emoji are 8 UTF-16 units but 4 characters.
  assert.equal(change({ reason: "🔧🔧🔧🔧" }).success, false);
  assert.equal(change({ reason: "🔧🔧🔧🔧🔧" }).success, true);
  for (const bad of [{ reason: "" }, { reason: "x".repeat(501) }, { newInvoiceDate: "2026-11-21" }, { newInvoiceDate: "2026-02-30" }, { newInvoiceRef: undefined },
    { newInvoiceRef: " " }, { action: "delete" }, { invoiceDate: "2026-02-30" }, { expectedCount: "0" }]) assert.equal(change(bad).success, false, JSON.stringify(bad));
  assert.deepEqual(limitUsage(0, null), { tone: "warning", percent: null });
  assert.deepEqual(limitUsage(7_999, 10_000), { tone: "success", percent: 79 });
  assert.deepEqual(limitUsage(8_000, 10_000), { tone: "warning", percent: 80 });
  assert.deepEqual(limitUsage(10_000, 10_000), { tone: "error", percent: 100 });
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

const placeOrder = async (code = "PART-A", partner = "bakimx") =>
  (await partnerOrders.createPartnerOrder(partner, randomUUID(), (await quoteAndBody([{ code, quantity: 1 }], partner)).body, config())).order;
const yurtici = { carrier: "yurtici" as const, carrierName: null, trackingNo: "123456789012", trackingUrl: null };

test("DELETE before confirmation cancels at once on the partner's behalf; repeating it answers the same", async () => {
  const order = await placeOrder();
  const first = await partnerCancel.cancelPartnerOrder("bakimx", order.id);
  assert.deepEqual([first.cancellation, first.order.status, first.order.cancelledBy, first.order.cancellationRequest], ["CANCELLED", "CANCELLED", "PARTNER", null]);
  const row = await orderRow(order.id);
  // On account: nothing to refund; noted like a customer's own cancel.
  assert.deepEqual([row.status, row.payment_status, row.cancelled_by, row.cancel_requested_at], ["cancelled", "on_account", "customer", null]);
  assert.match(row.payment_note, /Partner iptal etti\./);
  const again = await partnerCancel.cancelPartnerOrder("bakimx", order.id);
  assert.deepEqual([again.cancellation, again.order.cancelledAt], ["CANCELLED", first.order.cancelledAt]);
  // Another partner, a store order or a malformed id: not found, nothing changed.
  const other = await placeOrder("PART-B");
  await assert.rejects(partnerCancel.cancelPartnerOrder("other", other.id), refusal("ORDER_NOT_FOUND"));
  await assert.rejects(partnerCancel.cancelPartnerOrder("bakimx", "not-a-uuid"), refusal("ORDER_NOT_FOUND"));
  assert.equal((await orderRow(other.id)).status, "pending");
});

test("DELETE after confirmation is a request: shipping waits; a rejection is final and the order ships", async () => {
  const order = await placeOrder();
  assert.equal(await adminOrders.transitionOrder(order.id, "confirmed"), true);
  // Nothing to decide without a request.
  assert.equal(await adminOrders.decidePartnerCancelRequest(order.id, "reject"), false);
  const requested = await partnerCancel.cancelPartnerOrder("bakimx", order.id);
  assert.equal(requested.cancellation, "REQUESTED");
  assert.equal(requested.order.status, "CONFIRMED");
  assert.equal(requested.order.cancellationRequest?.status, "PENDING");
  const repeated = await partnerCancel.cancelPartnerOrder("bakimx", order.id);
  assert.deepEqual(repeated.order.cancellationRequest, requested.order.cancellationRequest);
  // The order may not ship while the request is open: it is listed under the cancel request tab, not the shipping one.
  const tabs = async () => (await schema.pool.query<{ shipping: boolean; cancel_request: boolean }>(`SELECT ${adminData.orderFilters.shipping.where} AS shipping,
    ${adminData.orderFilters.cancel_request.where} AS cancel_request FROM commerce_orders o WHERE o.id=$1`, [order.id])).rows[0];
  assert.deepEqual(await tabs(), { shipping: false, cancel_request: true });
  assert.equal(await adminOrders.shipOrder(order.id, yurtici), false);
  assert.equal((await orderRow(order.id)).status, "confirmed");
  assert.equal(await adminOrders.decidePartnerCancelRequest(order.id, "reject"), true);
  assert.equal(await adminOrders.decidePartnerCancelRequest(order.id, "approve"), false, "a rejection is final");
  assert.deepEqual(await tabs(), { shipping: true, cancel_request: false });
  const rejected = await partnerOrders.getPartnerOrder("bakimx", order.id);
  assert.equal(rejected.cancellationRequest?.status, "REJECTED");
  assert.ok(rejected.cancellationRequest?.decidedAt);
  await assert.rejects(partnerCancel.cancelPartnerOrder("bakimx", order.id), refusal("CANCELLATION_REJECTED"));
  assert.equal(await adminOrders.shipOrder(order.id, yurtici), true);
  await assert.rejects(partnerCancel.cancelPartnerOrder("bakimx", order.id), refusal("ORDER_ALREADY_SHIPPED"));
  await schema.pool.query("UPDATE commerce_orders SET status='delivered',delivered_at=now() WHERE id=$1", [order.id]);
  await assert.rejects(partnerCancel.cancelPartnerOrder("bakimx", order.id), refusal("ORDER_ALREADY_SHIPPED"));
});

test("an approved cancel request cancels the confirmed order on the partner's behalf", async () => {
  const order = await placeOrder();
  assert.equal(await adminOrders.transitionOrder(order.id, "confirmed"), true);
  // A supplier line already ordered is noted for operations, like a customer's cancel (#607).
  await schema.pool.query("UPDATE commerce_order_items SET procurement_status='ordered' WHERE order_id=$1", [order.id]);
  await partnerCancel.cancelPartnerOrder("bakimx", order.id);
  assert.equal(await adminOrders.decidePartnerCancelRequest(order.id, "approve"), true);
  const row = await orderRow(order.id);
  assert.deepEqual([row.status, row.payment_status, row.cancelled_by], ["cancelled", "on_account", "customer"]);
  assert.match(row.payment_note, /Partnerin iptal talebi onaylandı\. İptal anında 1 kalem tedarikçiye sipariş edilmiş/);
  const after = await partnerOrders.getPartnerOrder("bakimx", order.id);
  assert.deepEqual([after.status, after.cancelledBy, after.cancellationRequest?.status], ["CANCELLED", "PARTNER", "APPROVED"]);
  assert.equal(after.cancellationRequest?.decidedAt, after.cancelledAt);
  assert.equal((await partnerCancel.cancelPartnerOrder("bakimx", order.id)).cancellation, "CANCELLED");
});

test("dashboard revenue counts on-account orders by order time until cancelled", async () => {
  const revenue = async () => {
    const row = (await schema.pool.query<{ revenue_30d: string; on_account_30d: number; revenue_prev_30d: string }>(adminData.dashboardOrdersSql)).rows[0];
    return { revenue: Number(row.revenue_30d), count: row.on_account_30d, previous: Number(row.revenue_prev_30d) };
  };
  const before = await revenue();
  const order = await placeOrder();
  const counted = await revenue();
  assert.deepEqual([counted.revenue - before.revenue, counted.count - before.count], [order.totals.grossKurus, 1]);
  // Ordered 40 days ago: the previous period.
  await schema.pool.query("UPDATE commerce_orders SET created_at=now()-interval '40 days' WHERE id=$1", [order.id]);
  const moved = await revenue();
  assert.deepEqual([moved.revenue, moved.previous - before.previous], [before.revenue, order.totals.grossKurus]);
  await schema.pool.query("UPDATE commerce_orders SET created_at=now() WHERE id=$1", [order.id]);
  await partnerCancel.cancelPartnerOrder("bakimx", order.id);
  assert.deepEqual(await revenue(), before);
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

  // A paused partner (#1009): new quotes and orders are 503 ORDER_INTAKE_PAUSED, no-store; reads still answer.
  await intake.setPartnerIntakePaused("bakimx", true, null);
  response = await quoteRoute.POST(post("/order-quotes", { lines: [{ selectedOfferId: offers["PART-A"], quantity: 1 }] }, auth));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual([response.status, await errorCode(response)], [503, "ORDER_INTAKE_PAUSED"]);
  response = await ordersRoute.POST(post("/orders", body, { ...auth, "idempotency-key": randomUUID() }));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual([response.status, await errorCode(response)], [503, "ORDER_INTAKE_PAUSED"]);
  response = await ordersRoute.POST(post("/orders", body, { ...auth, "idempotency-key": key }));
  assert.equal(response.status, 200);
  response = await orderRoute.GET(get(`/orders/${created.order.id}`), { params: Promise.resolve({ id: created.order.id }) });
  assert.equal(response.status, 200);
  await intake.setPartnerIntakePaused("bakimx", false, null);

  // DELETE: 401 without a key, 404 for another partner's order, 200 when cancelled, 202 when requested.
  const remove = (id: string, headers: Record<string, string> = auth) =>
    orderRoute.DELETE(new NextRequest(`${base}/orders/${id}`, { method: "DELETE", headers }), { params: Promise.resolve({ id }) });
  response = await remove(created.order.id, {});
  assert.equal(response.status, 401);
  const foreign = await placeOrder("PART-B", "other");
  response = await remove(foreign.id);
  assert.deepEqual([response.status, await errorCode(response)], [404, "ORDER_NOT_FOUND"]);
  response = await remove(created.order.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const cancelled = await response.json() as { cancellation: string; order: { status: string; cancelledBy: string } };
  assert.deepEqual([cancelled.cancellation, cancelled.order.status, cancelled.order.cancelledBy], ["CANCELLED", "CANCELLED", "PARTNER"]);
  const confirmed = await placeOrder();
  assert.equal(await adminOrders.transitionOrder(confirmed.id, "confirmed"), true);
  response = await remove(confirmed.id);
  assert.equal(response.status, 202);
  assert.equal(((await response.json()) as { cancellation: string }).cancellation, "REQUESTED");
  assert.equal(await adminOrders.decidePartnerCancelRequest(confirmed.id, "reject"), true);
  response = await remove(confirmed.id);
  assert.deepEqual([response.status, await errorCode(response)], [409, "CANCELLATION_REJECTED"]);
});

// Partner return requests (#1007).
const shippedOrder = async (lines: { code: string; quantity: number }[], partner = "bakimx") => {
  const order = (await partnerOrders.createPartnerOrder(partner, randomUUID(), (await quoteAndBody(lines, partner)).body, config())).order;
  assert.equal(await adminOrders.transitionOrder(order.id, "confirmed"), true);
  assert.equal(await adminOrders.shipOrder(order.id, yurtici), true);
  return order;
};
const returnBody = (lines: { code: string; quantity: number; reason?: string }[], note?: string) => ({
  lines: lines.map(line => ({ selectedOfferId: offers[line.code], quantity: line.quantity, reason: (line.reason ?? "defective") as "defective" })),
  note: note ?? "",
});
const productOf = (code: string) => dto.decodeOfferId(offers[code]) as string;
const acceptedReturns = async (orderId: string) => (await schema.pool.query<{ product_id: string; quantity: number; reason: string; note: string; created_by: string | null; partner_return_request_id: string | null }>(
  "SELECT product_id::text,quantity,reason,note,created_by::text,partner_return_request_id::text FROM commerce_returns WHERE order_id=$1 ORDER BY created_at,product_id", [orderId])).rows;
let returnAdmin = "";
const adminId = async () => returnAdmin ||= (await schema.pool.query<{ id: string }>(
  "INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Operasyon','returns-admin@example.invalid','x','admin',true) RETURNING id::text")).rows[0].id;

test("return requests (#1007) need a shipped or delivered order; a request writes no commerce_returns row and leaves the exposure", async () => {
  const pending = await placeOrder();
  await assert.rejects(partnerReturns.requestPartnerReturn("bakimx", pending.id, randomUUID(), returnBody([{ code: "PART-A", quantity: 1 }])),
    refusal("ORDER_NOT_SHIPPED", details => assert.deepEqual(details, { status: "REQUESTED" })));
  assert.equal(await adminOrders.transitionOrder(pending.id, "confirmed"), true);
  await assert.rejects(partnerReturns.requestPartnerReturn("bakimx", pending.id, randomUUID(), returnBody([{ code: "PART-A", quantity: 1 }])),
    refusal("ORDER_NOT_SHIPPED", details => assert.deepEqual(details, { status: "CONFIRMED" })));
  const cancelled = await placeOrder();
  await partnerCancel.cancelPartnerOrder("bakimx", cancelled.id);
  await assert.rejects(partnerReturns.requestPartnerReturn("bakimx", cancelled.id, randomUUID(), returnBody([{ code: "PART-A", quantity: 1 }])),
    refusal("ORDER_NOT_SHIPPED", details => assert.deepEqual(details, { status: "CANCELLED" })));

  const order = await shippedOrder([{ code: "PART-A", quantity: 3 }, { code: "PART-B", quantity: 1 }]);
  const exposure = await limits.partnerExposure("bakimx");
  const key = randomUUID();
  const created = await partnerReturns.requestPartnerReturn("bakimx", order.id, key, returnBody([{ code: "PART-A", quantity: 2, reason: "not_fit" }], "Uymadı"));
  assert.equal(created.replayed, false);
  const line = order.lines.find(item => item.selectedOfferId === offers["PART-A"]);
  assert.ok(line);
  assert.deepEqual([created.return.status, created.return.orderId, created.return.idempotencyKey, created.return.note, created.return.decidedAt, created.return.contractVersion],
    ["REQUESTED", order.id, key, "Uymadı", null, "2.1"]);
  assert.deepEqual(created.return.lines, [{ selectedOfferId: offers["PART-A"], partNo: line.partNo, name: line.name, quantity: 2, reason: "NOT_FIT",
    unitNetKurus: line.unitNetKurus, vatRateBps: line.vatRateBps, ...lineAmounts(line.unitNetKurus, 2, line.vatRateBps) }]);
  assert.deepEqual(await acceptedReturns(order.id), []);
  assert.deepEqual(await limits.partnerExposure("bakimx"), exposure);
  // Delivered orders take requests too.
  await schema.pool.query("UPDATE commerce_orders SET status='delivered',delivered_at=now() WHERE id=$1", [order.id]);
  const delivered = await partnerReturns.requestPartnerReturn("bakimx", order.id, randomUUID(), returnBody([{ code: "PART-B", quantity: 1 }]));
  assert.equal(delivered.return.status, "REQUESTED");
  assert.deepEqual((await partnerReturns.listPartnerReturns("bakimx", order.id)).map(item => item.id), [created.return.id, delivered.return.id]);
});

test("return requests (#1007): Idempotency-Key replays the request, conflicts on another body or order, and concurrent retries make one", async () => {
  const order = await shippedOrder([{ code: "PART-A", quantity: 3 }]);
  const other = await shippedOrder([{ code: "PART-A", quantity: 3 }]);
  const key = randomUUID(), body = returnBody([{ code: "PART-A", quantity: 1 }]);
  const created = await partnerReturns.requestPartnerReturn("bakimx", order.id, key, body);
  const replayed = await partnerReturns.requestPartnerReturn("bakimx", order.id, key, body);
  assert.deepEqual(replayed, { return: created.return, replayed: true });
  await assert.rejects(partnerReturns.requestPartnerReturn("bakimx", order.id, key, returnBody([{ code: "PART-A", quantity: 2 }])), refusal("IDEMPOTENCY_CONFLICT"));
  await assert.rejects(partnerReturns.requestPartnerReturn("bakimx", other.id, key, body), refusal("IDEMPOTENCY_CONFLICT"));
  const concurrentKey = randomUUID();
  const results = await Promise.all([1, 2].map(() => partnerReturns.requestPartnerReturn("bakimx", other.id, concurrentKey, body)));
  assert.deepEqual(results.map(result => result.replayed).sort(), [false, true]);
  assert.equal(results[0].return.id, results[1].return.id);
  assert.equal(Number((await schema.pool.query("SELECT count(*) FROM partner_return_requests WHERE request_key=$1", [concurrentKey])).rows[0].count), 1);
});

test("return requests (#1007): accepted + pending + requested stay within the ordered quantity; admin returns count pending units; decisions", async () => {
  const order = await shippedOrder([{ code: "PART-A", quantity: 3 }]);
  const productId = productOf("PART-A");
  const admin = await adminId();
  const pending = await partnerReturns.requestPartnerReturn("bakimx", order.id, randomUUID(), returnBody([{ code: "PART-A", quantity: 2 }], "Kusurlu çıktı"));
  // Operations' own return record sees the pending 2 units: 2 + 2 > 3 is held by the request, 1 still fits (#1151).
  const record = (quantity: number) => adminOrders.recordOrderReturn({ orderId: order.id, productId, quantity, reason: "damaged", note: "", adminId: admin });
  assert.equal(await record(2), "pending");
  assert.equal(await record(1), "recorded");
  // 1 accepted + 3 overruns the ordered 3 even without the request.
  assert.equal(await record(3), "exceeded");
  // The order page lists the pending request's line beside the manual return form.
  assert.deepEqual((await partnerReturns.pendingReturnLines(order.id)).map(line => [line.request_id, line.product_id, line.quantity, line.reason, line.note]),
    [[pending.return.id, productId, 2, "defective", "Kusurlu çıktı"]]);
  await assert.rejects(partnerReturns.requestPartnerReturn("bakimx", order.id, randomUUID(), returnBody([{ code: "PART-A", quantity: 1 }])),
    refusal("RETURN_QUANTITY_EXCEEDED", details => assert.deepEqual(details, { lines: [{ selectedOfferId: offers["PART-A"], orderedQuantity: 3,
      returnedQuantity: 1, pendingQuantity: 2, requestedQuantity: 1 }] })));
  // A rejection releases the quantity; deciding again is refused.
  assert.equal(await partnerReturns.decidePartnerReturnRequest(pending.return.id, "reject", admin), true);
  assert.equal(await partnerReturns.decidePartnerReturnRequest(pending.return.id, "approve", admin), false);
  assert.deepEqual(await partnerReturns.pendingReturnLines(order.id), []);
  assert.equal((await partnerReturns.listPartnerReturns("bakimx", order.id))[0].status, "REJECTED");
  const again = await partnerReturns.requestPartnerReturn("bakimx", order.id, randomUUID(), returnBody([{ code: "PART-A", quantity: 2, reason: "wrong_item" }], "Yanlış ürün"));
  assert.equal(await partnerReturns.decidePartnerReturnRequest(again.return.id, "approve", admin), true);
  assert.equal(await partnerReturns.decidePartnerReturnRequest(again.return.id, "reject", admin), false);
  assert.deepEqual((await acceptedReturns(order.id)).map(row => [row.quantity, row.reason, row.note, row.created_by, row.partner_return_request_id]),
    [[1, "damaged", "", admin, null], [2, "wrong_item", "Yanlış ürün", admin, again.return.id]]);
  const decided = (await partnerReturns.listPartnerReturns("bakimx", order.id))[1];
  assert.equal(decided.status, "APPROVED");
  assert.ok(decided.decidedAt);
  await assert.rejects(partnerReturns.requestPartnerReturn("bakimx", order.id, randomUUID(), returnBody([{ code: "PART-A", quantity: 1 }])),
    refusal("RETURN_QUANTITY_EXCEEDED", details => assert.equal((details?.lines as { returnedQuantity: number }[])[0].returnedQuantity, 3)));
  assert.equal(await partnerReturns.decidePartnerReturnRequest(randomUUID(), "approve", admin), false);
});

test("return requests (#1007): two requests for the last unit at once, exactly one is recorded", async () => {
  const order = await shippedOrder([{ code: "PART-B", quantity: 1 }]);
  const results = await Promise.allSettled([1, 2].map(() => partnerReturns.requestPartnerReturn("bakimx", order.id, randomUUID(), returnBody([{ code: "PART-B", quantity: 1 }]))));
  assert.deepEqual(results.map(result => result.status).sort(), ["fulfilled", "rejected"]);
  const refused = results.find(result => result.status === "rejected");
  assert.ok(refused && refusal("RETURN_QUANTITY_EXCEEDED")(refused.reason));
});

test("return requests (#1007): unknown lines, other partners' orders and malformed ids; a paused partner may still return", async () => {
  const order = await shippedOrder([{ code: "PART-A", quantity: 1 }]);
  await assert.rejects(partnerReturns.requestPartnerReturn("bakimx", order.id, randomUUID(), returnBody([{ code: "PART-B", quantity: 1 }])),
    refusal("RETURN_LINE_UNKNOWN", details => assert.deepEqual(details, { selectedOfferIds: [offers["PART-B"]] })));
  const foreign = await shippedOrder([{ code: "PART-A", quantity: 1 }], "other");
  await assert.rejects(partnerReturns.requestPartnerReturn("bakimx", foreign.id, randomUUID(), returnBody([{ code: "PART-A", quantity: 1 }])), refusal("ORDER_NOT_FOUND"));
  await assert.rejects(partnerReturns.listPartnerReturns("bakimx", foreign.id), refusal("ORDER_NOT_FOUND"));
  await assert.rejects(partnerReturns.requestPartnerReturn("bakimx", "not-a-uuid", randomUUID(), returnBody([{ code: "PART-A", quantity: 1 }])), refusal("ORDER_NOT_FOUND"));
  await assert.rejects(partnerReturns.listPartnerReturns("bakimx", "not-a-uuid"), refusal("ORDER_NOT_FOUND"));
  assert.deepEqual(await partnerReturns.listPartnerReturns("bakimx", order.id), []);
  await intake.setPartnerIntakePaused("bakimx", true, null);
  try {
    const created = await partnerReturns.requestPartnerReturn("bakimx", order.id, randomUUID(), returnBody([{ code: "PART-A", quantity: 1 }]));
    assert.equal(created.return.status, "REQUESTED");
  } finally {
    await intake.setPartnerIntakePaused("bakimx", false, null);
  }
});

test("return requests (#1007): the İade talebi tab lists an order only while a request is pending", async () => {
  const order = await shippedOrder([{ code: "PART-A", quantity: 2 }]);
  const listed = async () => (await schema.pool.query<{ listed: boolean }>(`SELECT ${adminData.orderFilters.return_request.where} AS listed FROM commerce_orders o WHERE o.id=$1`,
    [order.id])).rows[0].listed;
  assert.equal(await listed(), false);
  const first = await partnerReturns.requestPartnerReturn("bakimx", order.id, randomUUID(), returnBody([{ code: "PART-A", quantity: 1 }]));
  assert.equal(await listed(), true);
  assert.equal(await partnerReturns.decidePartnerReturnRequest(first.return.id, "approve", null), true);
  assert.equal(await listed(), false);
  const second = await partnerReturns.requestPartnerReturn("bakimx", order.id, randomUUID(), returnBody([{ code: "PART-A", quantity: 1 }]));
  assert.equal(await listed(), true);
  assert.equal(await partnerReturns.decidePartnerReturnRequest(second.return.id, "reject", null), true);
  assert.equal(await listed(), false);
});

test("return requests (#1007) in the admin list: per-order jsonb list, tab count and navigation badge count only pending ones", async () => {
  const order = await shippedOrder([{ code: "PART-A", quantity: 3 }]);
  const counts = async () => {
    const tabs = (await schema.pool.query<Record<string, number>>(adminData.orderTabCountsSql)).rows[0];
    const nav = (await schema.pool.query<{ count: number }>(adminData.navOrderCountSql)).rows[0].count;
    return { tab: tabs.return_request, nav, shipped: tabs.shipped };
  };
  const listed = async () => (await schema.pool.query<{ return_requests: { id: string; status: string; note: string; requested_at: string; decided_at: string | null;
    lines: { product_id: string; quantity: number; reason: string }[] }[] }>(
    `SELECT ${adminData.orderReturnRequestsSql} AS return_requests FROM commerce_orders o WHERE o.id=$1`, [order.id])).rows[0].return_requests;
  assert.deepEqual(await listed(), []);
  const before = await counts();
  const request = (reason: string, note: string) => partnerReturns.requestPartnerReturn("bakimx", order.id, randomUUID(), returnBody([{ code: "PART-A", quantity: 1, reason }], note));
  const approved = await request("damaged", "Hasarlı");
  assert.equal(await partnerReturns.decidePartnerReturnRequest(approved.return.id, "approve", null), true);
  const rejected = await request("changed_mind", "Vazgeçti");
  assert.equal(await partnerReturns.decidePartnerReturnRequest(rejected.return.id, "reject", null), true);
  assert.deepEqual(await counts(), before, "decided requests are not counted");
  const pending = await request("not_fit", "");
  assert.deepEqual(await counts(), { tab: before.tab + 1, nav: before.nav + 1, shipped: before.shipped });
  const list = await listed();
  assert.deepEqual(list.map(item => [item.id, item.status, item.note, item.decided_at === null]), [
    [approved.return.id, "approved", "Hasarlı", false], [rejected.return.id, "rejected", "Vazgeçti", false], [pending.return.id, "requested", "", true]]);
  for (const [item, reason] of list.map((item, index) => [item, ["damaged", "changed_mind", "not_fit"][index]] as const)) {
    assert.deepEqual(item.lines, [{ product_id: productOf("PART-A"), quantity: 1, reason }]);
    assert.ok(!Number.isNaN(Date.parse(item.requested_at)));
  }
  // A request's lines belong to its own order (composite key).
  const other = await shippedOrder([{ code: "PART-B", quantity: 1 }]);
  await assert.rejects(schema.pool.query("INSERT INTO partner_return_request_lines(request_id,order_id,product_id,quantity,reason) VALUES($1,$2,$3,1,'other')",
    [pending.return.id, other.id, productOf("PART-B")]), (error: { code?: string }) => error.code === "23503");
  assert.equal(await partnerReturns.decidePartnerReturnRequest(pending.return.id, "reject", null), true);
  assert.deepEqual(await counts(), { ...before, shipped: before.shipped + 1 });
});

test("return route handlers (#1007): key, Idempotency-Key and body checks, 201 then 200 replay, tenant-scoped GET, no-store", async () => {
  const [{ NextRequest }, returnsRoute] = await Promise.all([import("next/server"), import("../src/app/api/partner/v1/orders/[id]/returns/route")]);
  const auth = { authorization: `Bearer ${"k".repeat(24)}` };
  const base = "https://getirbakim.com/api/partner/v1";
  const order = await shippedOrder([{ code: "PART-A", quantity: 2 }]);
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  const post = (id: string, body: unknown, headers: Record<string, string>) => returnsRoute.POST(new NextRequest(`${base}/orders/${id}/returns`,
    { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), context(id));
  const get = (id: string, headers: Record<string, string> = auth) => returnsRoute.GET(new NextRequest(`${base}/orders/${id}/returns`, { headers }), context(id));
  const errorCode = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;
  const body = { lines: [{ selectedOfferId: offers["PART-A"], quantity: 1, reason: "DEFECTIVE" }] };

  let response = await post(order.id, body, { "idempotency-key": randomUUID() });
  assert.deepEqual([response.status, await errorCode(response)], [401, "UNAUTHORIZED"]);
  response = await get(order.id, {});
  assert.equal(response.status, 401);
  for (const headers of [auth, { ...auth, "idempotency-key": "not-a-uuid" }]) {
    response = await post(order.id, body, headers);
    assert.deepEqual([response.status, await errorCode(response)], [400, "VALIDATION_ERROR"]);
  }
  const key = randomUUID();
  for (const invalid of ["{not json", { ...body, partner: "other" }, { lines: [] }, { lines: [{ ...body.lines[0], reason: "defective" }] }]) {
    response = await post(order.id, invalid, { ...auth, "idempotency-key": key });
    assert.deepEqual([response.status, await errorCode(response)], [400, "VALIDATION_ERROR"]);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  response = await post(order.id, body, { ...auth, "idempotency-key": key });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const created = await response.json() as { return: { id: string; status: string; lines: { reason: string }[] }; replayed: boolean };
  assert.deepEqual([created.replayed, created.return.status, created.return.lines[0].reason], [false, "REQUESTED", "DEFECTIVE"]);
  response = await post(order.id, body, { ...auth, "idempotency-key": key.toUpperCase() });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...created, replayed: true });
  response = await post(order.id, { ...body, note: "Başka" }, { ...auth, "idempotency-key": key });
  assert.deepEqual([response.status, await errorCode(response)], [409, "IDEMPOTENCY_CONFLICT"]);
  response = await post(order.id, { lines: [{ ...body.lines[0], quantity: 2 }] }, { ...auth, "idempotency-key": randomUUID() });
  assert.deepEqual([response.status, await errorCode(response)], [409, "RETURN_QUANTITY_EXCEEDED"]);

  response = await get(order.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(((await response.json()) as { returns: { id: string }[] }).returns.map(item => item.id), [created.return.id]);
  const foreign = await placeOrder("PART-B", "other");
  for (const id of [foreign.id, randomUUID(), "not-a-uuid"]) {
    response = await get(id);
    assert.deepEqual([response.status, await errorCode(response)], [404, "ORDER_NOT_FOUND"]);
    response = await post(id, body, { ...auth, "idempotency-key": randomUUID() });
    assert.deepEqual([response.status, await errorCode(response)], [404, "ORDER_NOT_FOUND"]);
  }
});
