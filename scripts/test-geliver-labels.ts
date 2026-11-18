import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { applySetupFiles, isolatedSchema } from "./isolated-schema";

// Geliver labels (#960) against an isolated copy of the schema. Every Geliver reply is mocked with synthetic data; the
// token is synthetic and fetch throws unless a test installs a reply, so no request reaches Geliver.
const SECRET = "synthetic-geliver-webhook-secret-0123456789";
const originalEnv = { token: process.env.GELIVER_API_TOKEN, mode: process.env.GELIVER_MODE, secret: process.env.GELIVER_WEBHOOK_SECRET };
process.env.GELIVER_API_TOKEN = "synthetic";
delete process.env.GELIVER_MODE;
process.env.GELIVER_WEBHOOK_SECRET = SECRET;

let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let labels: typeof import("../src/modules/shipping/geliver-labels");
let closeDb: () => Promise<void>;
let admin = "";

type Call = { url: string; method: string; body: unknown };
const calls: Call[] = [];
let handler: (call: Call) => Response | Promise<Response> = () => { throw new Error("unexpected Geliver call"); };
const originalFetch = globalThis.fetch;

before(async () => {
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    return handler(call);
  };
  schema = await isolatedSchema("geliver_test");
  const [{ db }, module] = await Promise.all([import("../src/lib/db"), import("../src/modules/shipping/geliver-labels")]);
  labels = module;
  closeDb = () => db.end();
  admin = (await schema.pool.query<{ id: string }>("INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Yönetici',$1,'x','admin',true) RETURNING id::text",
    [`${randomUUID()}@example.invalid`])).rows[0].id;
});
after(async () => {
  globalThis.fetch = originalFetch;
  const restore = (key: string, value: string | undefined) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };
  restore("GELIVER_API_TOKEN", originalEnv.token); restore("GELIVER_MODE", originalEnv.mode); restore("GELIVER_WEBHOOK_SECRET", originalEnv.secret);
  await closeDb?.(); await schema?.drop();
});

/** A confirmed, paid order to Kartal/İstanbul with one line; `address: false` = an order from before #881. */
async function seed({ status = "confirmed", paymentStatus = "paid", address = true } = {}) {
  const order = (await schema.pool.query<{ id: string; number: string }>(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,customer_name,email,phone,address,
    total_kurus,subtotal_kurus,discount_percent,status,payment_status,delivery_province,delivery_district,delivery_address_line)
    VALUES('guest',$1,$2,'Deneme Alıcı','alici@example.invalid','0532 000 00 00','Deneme Mah. No 1, Kartal/İstanbul',150000,150000,0,$3,$4,$5,$6,$7)
    RETURNING id::text,number::text`, [randomUUID(), randomUUID(), status, paymentStatus, address ? "İstanbul" : null, address ? "Kartal" : null, address ? "Deneme Mah. No 1" : null])).rows[0];
  await schema.pool.query(`INSERT INTO commerce_order_items(order_id,product_id,code,name,supplier,quantity,unit_price_kurus,pricing_snapshot)
    VALUES($1,$2,'F-1','Yağ filtresi','basbug',2,75000,'{}')`, [order.id, randomUUID()]);
  return order;
}
const orderRow = async (id: string) => (await schema.pool.query("SELECT * FROM commerce_orders WHERE id=$1", [id])).rows[0];
const labelRows = async (id: string) => (await schema.pool.query("SELECT * FROM commerce_geliver_shipments WHERE order_id=$1 ORDER BY requested_at,id", [id])).rows;
const parcel = { preset: "small" as const, length: 20, width: 15, height: 10, weight: 1 };
const create = (orderId: string) => labels.createGeliverLabel({ orderId, parcel, adminId: admin });
const age = (orderId: string, minutes = 2) =>
  schema.pool.query("UPDATE commerce_geliver_shipments SET requested_at=now()-make_interval(mins=>$2) WHERE order_id=$1", [orderId, minutes]);

/** Geliver's reply to POST /transactions (synthetic). */
const shipment = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(), createdAt: new Date().toISOString(), test: true, barcode: "86200000001", labelURL: "https://labels.example.invalid/label.pdf",
  trackingStatus: null, statusCode: "TRACKING_CODE_CREATED", providerServiceCode: "GELIVER_STANDART", hasError: false, ...overrides,
});
const purchased = (data = shipment()) => Response.json({ result: true, message: "Success", data: { id: randomUUID(), shipment: data } }, { status: 201 });
const found = (list: unknown[]) => Response.json({ result: true, additionalMessage: "Success", limit: 20, page: 1, totalRows: list.length, totalPages: 1, data: list });
const fail = () => { throw new Error("unexpected Geliver call"); };

test("a label ships the order with Yurtiçi; the tracking number comes later", async () => {
  const order = await seed();
  const remote = shipment();
  calls.length = 0;
  handler = () => purchased(remote);
  assert.deepEqual(await create(order.id), { outcome: "purchased" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.geliver.io/api/v1/transactions");
  const body = calls[0].body as { providerServiceCode: string; shipment: { test: boolean; recipientAddress: { cityCode: string; phone: string }; order: { orderNumber: string } } };
  assert.equal(body.providerServiceCode, "GELIVER_STANDART");
  assert.equal(body.shipment.test, true);
  assert.equal(body.shipment.recipientAddress.cityCode, "34");
  assert.equal(body.shipment.recipientAddress.phone, "+905320000000");
  assert.equal(body.shipment.order.orderNumber, `TEST-${order.number}`);
  const row = await orderRow(order.id);
  assert.equal(row.status, "shipped"); assert.ok(row.shipped_at);
  assert.equal(row.carrier, "yurtici"); assert.equal(row.carrier_name, null); assert.equal(row.tracking_no, null);
  assert.equal(row.tracking_url, `https://app.geliver.io/tracking/${remote.id}`);
  const [label] = await labelRows(order.id);
  assert.equal(label.status, "purchased"); assert.equal(label.test, true); assert.equal(label.geliver_shipment_id, remote.id);
  assert.equal(label.barcode, "86200000001"); assert.equal(label.label_url, "https://labels.example.invalid/label.pdf");
  assert.equal(label.order_number, `TEST-${order.number}`); assert.deepEqual(label.parcel, parcel); assert.equal(label.requested_by, admin);

  handler = fail;
  calls.length = 0;
  assert.equal((await create(order.id)).outcome, "not_allowed", "a shipped order takes no second label");
  assert.equal(calls.length, 0);
});

test("concurrent requests for one order make a single Geliver call", async () => {
  const order = await seed();
  calls.length = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  handler = async () => { await gate; return purchased(); };
  const first = create(order.id);
  // The first request has committed its row before calling Geliver.
  while (!calls.length) await new Promise(resolve => setTimeout(resolve, 5));
  const second = await create(order.id);
  release();
  assert.equal(second.outcome, "busy");
  assert.equal((await first).outcome, "purchased");
  assert.equal(calls.length, 1);
  assert.equal((await labelRows(order.id)).length, 1);
});

test("a refusal fails the row, keeps the order confirmed and allows another try", async () => {
  const order = await seed();
  handler = () => Response.json({ result: false, code: "E1066", message: "Organizasyonun yeterli bakiyesi yok" }, { status: 400 });
  const result = await create(order.id);
  assert.equal(result.outcome, "failed");
  assert.match(result.message ?? "", /bakiyesi yetersiz/);
  assert.equal((await orderRow(order.id)).status, "confirmed");
  const [row] = await labelRows(order.id);
  assert.equal(row.status, "failed"); assert.equal(row.error_code, "E1066"); assert.ok(row.completed_at);
  handler = () => purchased();
  assert.equal((await create(order.id)).outcome, "purchased");
  assert.deepEqual((await labelRows(order.id)).map(r => r.status), ["failed", "purchased"]);
});

test("a lost reply leaves the row unknown and blocks new labels until checked", async () => {
  const order = await seed();
  handler = () => { throw new DOMException("The operation timed out.", "TimeoutError"); };
  assert.equal((await create(order.id)).outcome, "unknown");
  assert.equal((await labelRows(order.id))[0].status, "unknown");
  assert.equal((await orderRow(order.id)).status, "confirmed");
  calls.length = 0;
  handler = fail;
  assert.equal((await create(order.id)).outcome, "busy");
  assert.equal(calls.length, 0);
  const [row] = await labelRows(order.id);
  assert.equal((await labels.checkGeliverLabel({ shipmentRowId: row.id, orderId: order.id })).outcome, "unknown", "too early to check");
  assert.equal(calls.length, 0);
});

test("checking finds the label on Geliver and ships the order", async () => {
  const order = await seed();
  handler = () => new Response("bad gateway", { status: 502 });
  assert.equal((await create(order.id)).outcome, "unknown");
  await age(order.id);
  const [row] = await labelRows(order.id);
  const remote = shipment({ order: { orderNumber: `TEST-${order.number}` }, trackingNumber: "26895919",
    trackingStatus: { trackingStatusCode: "PRE_TRANSIT", trackingSubStatusCode: "information_received", statusDate: new Date().toISOString(), locationName: "Kartal" } });
  calls.length = 0;
  handler = call => {
    assert.match(call.url, /\/shipments\?/);
    assert.equal(new URL(call.url).searchParams.get("orderNumber"), `TEST-${order.number}`);
    return found([shipment({ test: false }), remote]);
  };
  assert.equal((await labels.checkGeliverLabel({ shipmentRowId: row.id, orderId: order.id })).outcome, "purchased");
  assert.equal(calls.length, 1, "the list is enough; no detail request");
  const settled = (await labelRows(order.id))[0];
  assert.equal(settled.status, "purchased"); assert.equal(settled.geliver_shipment_id, remote.id); assert.equal(settled.tracking_status_code, "PRE_TRANSIT");
  const shipped = await orderRow(order.id);
  assert.equal(shipped.status, "shipped"); assert.equal(shipped.carrier, "yurtici"); assert.equal(shipped.tracking_no, "26895919");
});

test("checking with nothing on Geliver fails the row only after five minutes; other test/live kinds and older shipments do not count", async () => {
  const order = await seed();
  handler = () => { throw new TypeError("fetch failed"); };
  assert.equal((await create(order.id)).outcome, "unknown");
  await age(order.id, 2);
  const [row] = await labelRows(order.id);
  handler = () => found([shipment({ test: false }), shipment({ createdAt: new Date(Date.now() - 3_600_000).toISOString() })]);
  assert.equal((await labels.checkGeliverLabel({ shipmentRowId: row.id, orderId: order.id })).outcome, "unknown", "Geliver's list may still lag");
  assert.equal((await labelRows(order.id))[0].status, "unknown");
  await age(order.id, 6);
  const result = await labels.checkGeliverLabel({ shipmentRowId: row.id, orderId: order.id });
  assert.equal(result.outcome, "failed");
  assert.equal((await labelRows(order.id))[0].status, "failed");
  assert.equal((await orderRow(order.id)).status, "confirmed");
  handler = () => purchased();
  assert.equal((await create(order.id)).outcome, "purchased", "a new label is allowed");
});

test("a shipment without a label proves no purchase: unknown at first, failed after ten minutes", async () => {
  const order = await seed();
  handler = () => { throw new TypeError("fetch failed"); };
  assert.equal((await create(order.id)).outcome, "unknown");
  await age(order.id, 2);
  const [row] = await labelRows(order.id);
  const offersOnly = shipment({ statusCode: "GOT_OFFERS", barcode: null, labelURL: null, createdAt: new Date(Date.now() - 60_000).toISOString() });
  handler = () => found([offersOnly]);
  assert.equal((await labels.checkGeliverLabel({ shipmentRowId: row.id, orderId: order.id })).outcome, "unknown");
  assert.equal((await labelRows(order.id))[0].status, "unknown");
  assert.equal((await orderRow(order.id)).status, "confirmed");
  // A label-carrying state with a barcode but still an offer state does not count either.
  handler = () => found([shipment({ statusCode: "OFFER_ACCEPTED", createdAt: new Date(Date.now() - 60_000).toISOString() })]);
  assert.equal((await labels.checkGeliverLabel({ shipmentRowId: row.id, orderId: order.id })).outcome, "unknown");
  await age(order.id, 11);
  handler = () => found([offersOnly]);
  const result = await labels.checkGeliverLabel({ shipmentRowId: row.id, orderId: order.id });
  assert.equal(result.outcome, "failed");
  assert.equal(result.message, "Geliver'de etiketi alınmamış bir gönderi var; Geliver panelini kontrol edin.");
  assert.equal((await orderRow(order.id)).status, "confirmed");
});

test("an unanswered check keeps the row unknown", async () => {
  const order = await seed();
  handler = () => { throw new TypeError("fetch failed"); };
  await create(order.id);
  await age(order.id);
  const [row] = await labelRows(order.id);
  assert.equal((await labels.checkGeliverLabel({ shipmentRowId: row.id, orderId: order.id })).outcome, "unknown");
  assert.equal((await labelRows(order.id))[0].status, "unknown");
});

test("orders that cannot be shipped by Geliver are refused without a call", async () => {
  calls.length = 0;
  handler = fail;
  for (const options of [{ status: "pending" }, { status: "shipped" }, { status: "confirmed", paymentStatus: "awaiting" }, { status: "confirmed", paymentStatus: "refund_required" }]) {
    const order = await seed(options);
    assert.equal((await create(order.id)).outcome, "not_allowed", JSON.stringify(options));
  }
  const old = await seed({ address: false });
  const result = await create(old.id);
  assert.equal(result.outcome, "not_allowed");
  assert.match(result.message ?? "", /yapılandırılmış adres yok/);
  assert.equal((await create(randomUUID())).outcome, "not_allowed");
  assert.equal(calls.length, 0);
});

test("a label bought while the order was cancelled is recorded and noted, the order stays cancelled", async () => {
  const order = await seed();
  handler = async () => {
    await schema.pool.query("UPDATE commerce_orders SET status='cancelled',payment_status='refund_required' WHERE id=$1", [order.id]);
    return purchased();
  };
  assert.equal((await create(order.id)).outcome, "purchased_order_changed");
  const row = await orderRow(order.id);
  assert.equal(row.status, "cancelled"); assert.equal(row.carrier, null);
  assert.match(row.payment_note, /Geliver etiketi alındı \(barkod 86200000001\) ama sipariş durumu değişmişti/);
  assert.equal((await labelRows(order.id))[0].status, "purchased");
});

const webhook = (body: unknown, auth: { header?: string | null; token?: string | null } = { token: SECRET }) =>
  labels.handleGeliverWebhook({ header: auth.header ?? null, token: auth.token ?? null, rawBody: JSON.stringify(body) });
/** `updatedAt` is Geliver's clock; statusDate (the carrier's time) is the same unless given. */
const trackEvent = (id: string, code: string, sub: string, updatedAt: string | null, extra: Record<string, unknown> = {}, statusDate: string | null = updatedAt) => ({
  event: "TRACK_UPDATED", metadata: "",
  data: { id, trackingStatus: { trackingStatusCode: code, trackingSubStatusCode: sub, statusDetails: `${code} ayrıntı`, statusDate, locationName: "Kartal",
    updatedAt }, ...extra },
});
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
async function shippedByGeliver({ test: isTest = false } = {}) {
  const order = await seed();
  const remote = shipment({ test: isTest });
  if (!isTest) process.env.GELIVER_MODE = "live";
  handler = () => purchased(remote);
  try { assert.equal((await create(order.id)).outcome, "purchased"); }
  finally { delete process.env.GELIVER_MODE; }
  return { order, remote };
}

test("webhook: a wrong or missing secret is refused; unknown shipments and other bodies are ignored", async () => {
  handler = fail;
  assert.deepEqual(await webhook(trackEvent(randomUUID(), "TRANSIT", "package_accepted", null), { token: "wrong" }), { status: 401 });
  assert.deepEqual(await webhook(trackEvent(randomUUID(), "TRANSIT", "package_accepted", null), {}), { status: 401 });
  const unknown = await webhook(trackEvent(randomUUID(), "TRANSIT", "package_accepted", null), { header: SECRET });
  assert.deepEqual(unknown, { status: 200, outcome: "ignored", reason: "unknown_shipment", via: "header" });
  assert.equal((await labels.handleGeliverWebhook({ header: SECRET, token: null, rawBody: "not json" })).status, 200);
  const other = await webhook({ event: "TRANSACTION_CREATED", data: { id: "x", trackingStatus: { trackingStatusCode: "TRANSIT" } } });
  assert.equal(other.status === 200 && other.outcome === "ignored" && other.reason, "not_track_updated");
});

test("webhook: transit fills the tracking number; delivered delivers the order once", async () => {
  const { order, remote } = await shippedByGeliver();
  const live = await orderRow(order.id);
  assert.equal(live.tracking_url, `https://app.geliver.io/tracking/${remote.id}`);
  assert.equal((await labelRows(order.id))[0].service_code, "YURTICI_STANDART");

  const transit = await webhook(trackEvent(remote.id, "TRANSIT", "package_accepted", "2026-11-18T10:00:00+03:00", { trackingNumber: "123456789012" }));
  assert.deepEqual(transit, { status: 200, outcome: "applied", orderId: order.id, via: "token" });
  let row = await orderRow(order.id);
  assert.equal(row.status, "shipped"); assert.equal(row.tracking_no, "123456789012");
  assert.equal(row.tracking_url, "https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=123456789012");
  let [label] = await labelRows(order.id);
  assert.equal(label.tracking_status_code, "TRANSIT"); assert.equal(label.tracking_sub_status_code, "package_accepted");
  assert.equal(label.tracking_location, "Kartal"); assert.equal(label.tracking_number, "123456789012");

  const repeat = await webhook(trackEvent(remote.id, "TRANSIT", "package_accepted", "2026-11-18T10:00:00+03:00", { trackingNumber: "123456789012" }));
  assert.equal(repeat.status === 200 && repeat.outcome, "ignored");
  const stale = await webhook(trackEvent(remote.id, "PRE_TRANSIT", "information_received", "2026-11-18T09:00:00+03:00"));
  assert.equal(stale.status === 200 && stale.outcome, "ignored");
  assert.equal((await labelRows(order.id))[0].tracking_status_code, "TRANSIT");

  await schema.pool.query("UPDATE commerce_orders SET shipped_at=now()-interval '2 hours' WHERE id=$1", [order.id]);
  const deliveredAt = ago(30);
  assert.equal((await webhook(trackEvent(remote.id, "DELIVERED", "delivered", ago(29), {}, deliveredAt))).status, 200);
  row = await orderRow(order.id);
  assert.equal(row.status, "delivered");
  assert.equal(new Date(row.delivered_at).toISOString(), deliveredAt);
  [label] = await labelRows(order.id);
  assert.equal(label.tracking_status_code, "DELIVERED");
  // A later DELIVERED (another time) changes the label only; the order stays delivered with its first time.
  await webhook(trackEvent(remote.id, "DELIVERED", "delivered", ago(10), {}, ago(10)));
  assert.equal(new Date((await orderRow(order.id)).delivered_at).toISOString(), deliveredAt);
});

test("webhook: events are ordered by Geliver's clock; a delivery of a shipped order is never stale", async () => {
  const { order, remote } = await shippedByGeliver();
  await schema.pool.query("UPDATE commerce_orders SET shipped_at='2026-11-17T08:00:00Z' WHERE id=$1", [order.id]);
  // Stored: TRANSIT recorded by Geliver at 10:00, no statusDate.
  await webhook(trackEvent(remote.id, "TRANSIT", "package_accepted", "2026-11-18T10:00:00Z", {}, null));
  // Incoming: DELIVERED, carrier time 09:30 (earlier), Geliver time 10:30 (later): applied.
  const delivered = await webhook(trackEvent(remote.id, "DELIVERED", "delivered", "2026-11-18T10:30:00Z", {}, "2026-11-18T09:30:00Z"));
  assert.equal(delivered.status === 200 && delivered.outcome, "applied");
  const row = await orderRow(order.id);
  assert.equal(row.status, "delivered");
  assert.equal(new Date(row.delivered_at).toISOString(), "2026-11-18T09:30:00.000Z");
  const [label] = await labelRows(order.id);
  assert.equal(new Date(label.tracking_status_at).toISOString(), "2026-11-18T09:30:00.000Z");
  assert.equal(new Date(label.tracking_updated_at).toISOString(), "2026-11-18T10:30:00.000Z");

  const second = await shippedByGeliver();
  await webhook(trackEvent(second.remote.id, "TRANSIT", "out_for_delivery", "2026-11-18T10:00:00Z"));
  // Older on Geliver's clock, but a delivery of a shipped order: applied anyway; a future carrier time is capped at now.
  await webhook(trackEvent(second.remote.id, "DELIVERED", "delivered", "2026-11-18T09:00:00Z", {}, "2099-01-01T00:00:00Z"));
  const capped = await orderRow(second.order.id);
  assert.equal(capped.status, "delivered");
  assert.ok(new Date(capped.delivered_at).getTime() <= Date.now() + 1000);
  assert.equal(new Date((await labelRows(second.order.id))[0].tracking_updated_at).toISOString(), "2026-11-18T10:00:00.000Z", "the clock never goes back");

  // A carrier time before shipping is raised to the shipping time; an unreadable one means now.
  const third = await shippedByGeliver();
  await schema.pool.query("UPDATE commerce_orders SET shipped_at='2026-11-17T08:00:00Z' WHERE id=$1", [third.order.id]);
  await webhook(trackEvent(third.remote.id, "DELIVERED", "delivered", "2026-11-18T10:00:00Z", {}, "2026-11-01T00:00:00Z"));
  assert.equal(new Date((await orderRow(third.order.id)).delivered_at).toISOString(), "2026-11-17T08:00:00.000Z");
  const fourth = await shippedByGeliver();
  await webhook(trackEvent(fourth.remote.id, "DELIVERED", "delivered", "2026-11-18T10:00:00Z", {}, "0001-01-01T00:00:00Z"));
  assert.ok(Math.abs(new Date((await orderRow(fourth.order.id)).delivered_at).getTime() - Date.now()) < 60_000);
});

test("a production server in test mode buys no label unless explicitly allowed", async () => {
  const env = process.env as Record<string, string | undefined>;
  const original = env.NODE_ENV;
  const order = await seed();
  calls.length = 0;
  handler = fail;
  env.NODE_ENV = "production";
  try {
    const result = await create(order.id);
    assert.deepEqual(result, { outcome: "unavailable", message: "Geliver test modunda; canlı etiket için GELIVER_MODE=live ayarlanmalı." });
    assert.equal(calls.length, 0);
    assert.equal((await labelRows(order.id)).length, 0);
    env.GELIVER_ALLOW_TEST_IN_PRODUCTION = "1";
    handler = () => purchased();
    assert.equal((await create(order.id)).outcome, "purchased");
  } finally {
    if (original === undefined) delete env.NODE_ENV; else env.NODE_ENV = original;
    delete env.GELIVER_ALLOW_TEST_IN_PRODUCTION;
  }
});

test("webhook: a tracking number or link entered by hand is kept", async () => {
  const { order, remote } = await shippedByGeliver();
  await schema.pool.query("UPDATE commerce_orders SET tracking_no='999999999999',tracking_url='https://example.invalid/manual' WHERE id=$1", [order.id]);
  await webhook(trackEvent(remote.id, "TRANSIT", "package_accepted", "2026-11-18T10:00:00+03:00", { trackingNumber: "123456789012" }));
  const row = await orderRow(order.id);
  assert.equal(row.tracking_no, "999999999999"); assert.equal(row.tracking_url, "https://example.invalid/manual");
  assert.equal((await labelRows(order.id))[0].tracking_number, "123456789012");
});

test("webhook: an order delivered by hand, returned or failed shipments leave the order status alone", async () => {
  const { order, remote } = await shippedByGeliver({ test: true });
  await webhook(trackEvent(remote.id, "RETURNED", "return_to_sender", "2026-11-18T10:00:00+03:00", { trackingNumber: "12345678" }));
  let row = await orderRow(order.id);
  assert.equal(row.status, "shipped");
  assert.equal(row.tracking_no, "12345678");
  assert.equal(row.tracking_url, `https://app.geliver.io/tracking/${remote.id}`, "test labels never link to a carrier");
  await schema.pool.query("UPDATE commerce_orders SET status='delivered',delivered_at='2026-11-18T12:00:00Z' WHERE id=$1", [order.id]);
  await webhook(trackEvent(remote.id, "DELIVERED", "delivered", "2026-11-19T10:00:00+03:00"));
  row = await orderRow(order.id);
  assert.equal(row.status, "delivered");
  assert.equal(new Date(row.delivered_at).toISOString(), "2026-11-18T12:00:00.000Z");
});

test("the setup files can be applied twice", async () => {
  const client = await schema.pool.connect();
  try { await applySetupFiles(client); await applySetupFiles(client); }
  finally { client.release(); }
  const indexes = (await schema.pool.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND tablename='commerce_geliver_shipments' ORDER BY 1", [schema.name])).rows.map(r => r.indexname);
  assert.deepEqual(indexes, ["commerce_geliver_shipments_active_idx", "commerce_geliver_shipments_order_idx", "commerce_geliver_shipments_pkey", "commerce_geliver_shipments_remote_idx"]);
});
