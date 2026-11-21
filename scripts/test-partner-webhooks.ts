import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import type { PartnerWebhookEndpoint } from "../src/modules/partner/webhook-contract";
import type { WebhookRequest } from "../src/modules/partner/webhooks";

// Partner webhook outbox (#1002) in an isolated copy of the schema: the trigger on commerce_orders, delivery, retries,
// the 72-hour give-up and concurrent claims. Sends are injected; nothing leaves the process.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let webhooks: typeof import("../src/modules/partner/webhooks");
let orders: typeof import("../src/modules/partner/orders");
let closeDb: () => Promise<void>;

const secret = "test-webhook-secret-0123456789abcdef";
const endpoints = new Map<string, PartnerWebhookEndpoint>([["bakimx", { url: "https://bakimx.example.invalid/hooks", secret }]]);

before(async () => {
  schema = await isolatedSchema("partner_webhooks_test");
  const [{ db }, webhookModule, ordersModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/partner/webhooks"), import("../src/modules/partner/orders")]);
  webhooks = webhookModule; orders = ordersModule;
  closeDb = () => db.end();
});
after(async () => {
  await closeDb?.();
  await schema?.drop();
});

/** A placed partner order (status pending, on account) with one line. */
async function partnerOrder(partner = "bakimx") {
  const id = (await schema.pool.query<{ id: string }>(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,customer_name,email,phone,address,
    total_kurus,subtotal_kurus,discount_percent,status,payment_status,delivery_province,delivery_district,delivery_address_line)
    VALUES('partner',$1,$2,'Usta Oto Servis','','05320000000','Test Mahallesi 1. Sokak No 2 Kadıköy/İstanbul',120000,120000,0,'pending','on_account','İstanbul','Kadıköy','Test Mahallesi 1. Sokak No 2')
    RETURNING id::text`, [partner, randomUUID()])).rows[0].id;
  await schema.pool.query(`INSERT INTO commerce_order_items(order_id,product_id,code,name,supplier,quantity,unit_price_kurus,pricing_snapshot)
    VALUES($1,$2,'LUK 510 0207 10','DEBRIYAJ RULMANI','basbug',1,120000,$3)`, [id, randomUUID(),
    { nf: 70, company: "BASBUG", partner: { unit_net_kurus: 100000, vat_rate_bps: 2000, line_net_kurus: 100000, line_vat_kurus: 20000, line_gross_kurus: 120000 } }]);
  return id;
}
const events = async (orderId: string) => (await schema.pool.query<{ id: string; event_type: string; order_status: string; status: string; attempts: number;
  last_http_status: number | null; last_error: string | null; partner_code: string }>(
  "SELECT id::text,event_type,order_status,status,attempts,last_http_status,last_error,partner_code FROM partner_webhook_events WHERE order_id=$1 ORDER BY created_at,id", [orderId])).rows;
const update = (orderId: string, set: string) => schema.pool.query(`UPDATE commerce_orders SET ${set} WHERE id=$1`, [orderId]);

/** Records every request and answers with `status` (or throws when it is an Error). */
function recorder(answer: number | Error = 204, delayMs = 0) {
  const sent: WebhookRequest[] = [];
  const send = async (request: WebhookRequest) => {
    sent.push(request);
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    if (answer instanceof Error) throw answer;
    return { status: answer };
  };
  return { sent, send };
}

test("the trigger writes one event per partner-visible change of a partner order", async () => {
  const id = await partnerOrder();
  assert.equal((await events(id)).length, 0, "placing the order writes nothing");
  await update(id, "status='confirmed'");
  await update(id, "status='shipped',shipped_at=now(),carrier='yurtici',carrier_name=NULL,tracking_no='123456789012',tracking_url='https://kargo.example.invalid/1'");
  await update(id, "tracking_no='123456789013'");
  await update(id, "status='delivered',delivered_at=now()");
  const written = await events(id);
  assert.deepEqual(written.map(row => [row.event_type, row.order_status, row.status, row.partner_code]), [
    ["partner.order.updated", "confirmed", "pending", "bakimx"], ["partner.order.updated", "shipped", "pending", "bakimx"],
    ["partner.order.updated", "shipped", "pending", "bakimx"], ["partner.order.updated", "delivered", "pending", "bakimx"],
  ]);

  const cancel = await partnerOrder();
  await update(cancel, "status='confirmed'");
  await update(cancel, "cancel_requested_at=COALESCE(cancel_requested_at,now())");
  await update(cancel, "cancel_requested_at=COALESCE(cancel_requested_at,now())");
  await update(cancel, "cancel_request_rejected_at=now()");
  assert.equal((await events(cancel)).length, 3, "confirm, cancel request and its rejection; the repeated request changes nothing");
  const cancelled = await partnerOrder();
  await update(cancelled, "status='cancelled',cancelled_by='customer',cancelled_at=now()");
  assert.deepEqual((await events(cancelled)).map(row => row.order_status), ["cancelled"]);
});

test("the trigger ignores store orders, invoice marks, payment notes and updates that change nothing", async () => {
  const id = await partnerOrder();
  await update(id, "status='delivered',delivered_at=now()");
  const before = (await events(id)).length;
  await update(id, "partner_invoiced_at=now(),partner_invoice_ref='GB2026000001'");
  await update(id, "payment_note='not'");
  await update(id, "status=status,tracking_no=tracking_no");
  assert.equal((await events(id)).length, before);
  const store = (await schema.pool.query<{ id: string }>(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,customer_name,email,phone,address,total_kurus,subtotal_kurus,discount_percent,status,payment_status)
    VALUES('account',$1,$2,'Müşteri','m@example.invalid','5551234567','Adres',1000,1000,0,'pending','paid') RETURNING id::text`, [randomUUID(), randomUUID()])).rows[0].id;
  await update(store, "status='confirmed'");
  await update(store, "status='cancelled',cancelled_by='admin',cancelled_at=now()");
  assert.equal((await events(store)).length, 0);
});

test("a 2xx answer delivers the current order, signed, with the contract headers", async () => {
  const id = await partnerOrder();
  await update(id, "status='confirmed'");
  await update(id, "status='shipped',shipped_at=now(),carrier='yurtici',tracking_no='999'");
  const { sent, send } = recorder(200);
  const started = Math.floor(Date.now() / 1000);
  assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: id, send, endpoints }), { delivered: 2, skipped: 0, dead: 0, retried: 0 });
  const rows = await events(id);
  assert.deepEqual(rows.map(row => [row.status, row.attempts, row.last_http_status, row.last_error]), [["delivered", 1, 200, null], ["delivered", 1, 200, null]]);
  const current = (await orders.readOrder("bakimx", "id", id))!.dto;
  for (const [index, request] of sent.entries()) {
    assert.equal(request.url, "https://bakimx.example.invalid/hooks");
    const body = JSON.parse(request.body);
    // State-carrying: both events carry the order as it is when sent (shipped), not as it was when written.
    assert.deepEqual(body.order, JSON.parse(JSON.stringify(current)));
    assert.equal(body.order.status, "SHIPPED");
    assert.deepEqual([body.specVersion, body.eventId, body.eventType, body.partnerId], ["1.0", rows[index].id, "partner.order.updated", "bakimx"]);
    assert.equal(request.headers["Content-Type"], "application/json");
    assert.equal(request.headers["User-Agent"], "GetirBakim-Webhooks/1");
    assert.equal(request.headers["X-GetirBakim-Event-Id"], rows[index].id);
    assert.equal(request.headers["X-GetirBakim-Event-Type"], "partner.order.updated");
    const timestamp = request.headers["X-GetirBakim-Timestamp"];
    assert.ok(Number(timestamp) >= started && Number(timestamp) <= Math.floor(Date.now() / 1000) + 1);
    const expected = `v1=${createHmac("sha256", secret).update(`${timestamp}.${request.body}`).digest("hex")}`;
    assert.equal(request.headers["X-GetirBakim-Signature"], expected);
    for (const internal of ["BASBUG", `"nf"`, "basbug", secret]) assert.ok(!request.body.includes(internal), internal);
  }
  // Delivered rows are not sent again.
  assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: id, send, endpoints }), { delivered: 0, skipped: 0, dead: 0, retried: 0 });
  assert.equal(sent.length, 2);
});

test("a non-2xx answer, a redirect or a network error keeps the event pending until the backoff has passed", async () => {
  for (const [answer, httpStatus, error] of [[500, 500, "HTTP 500"], [302, 302, "HTTP 302 (redirect not followed)"], [new Error("connect ECONNREFUSED"), null, "connect ECONNREFUSED"]] as const) {
    const id = await partnerOrder();
    await update(id, "status='confirmed'");
    const failing = recorder(answer);
    assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: id, send: failing.send, endpoints }), { delivered: 0, skipped: 0, dead: 0, retried: 1 });
    assert.deepEqual((await events(id)).map(row => [row.status, row.attempts, row.last_http_status, row.last_error]), [["pending", 1, httpStatus, error]]);
    // Within the 5-minute backoff the event is not claimed again.
    const ok = recorder(204);
    assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: id, send: ok.send, endpoints }), { delivered: 0, skipped: 0, dead: 0, retried: 0 });
    assert.equal(ok.sent.length, 0);
    await schema.pool.query("UPDATE partner_webhook_events SET claimed_at=claimed_at-interval '6 minutes' WHERE order_id=$1", [id]);
    assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: id, send: ok.send, endpoints }), { delivered: 1, skipped: 0, dead: 0, retried: 0 });
    assert.deepEqual((await events(id)).map(row => [row.status, row.attempts, row.last_http_status, row.last_error]), [["delivered", 2, 204, null]]);
  }
  // The second failure waits 15 minutes, not 5.
  const id = await partnerOrder();
  await update(id, "status='confirmed'");
  const failing = recorder(503);
  await webhooks.deliverPartnerWebhooks({ orderId: id, send: failing.send, endpoints });
  await schema.pool.query("UPDATE partner_webhook_events SET claimed_at=claimed_at-interval '6 minutes' WHERE order_id=$1", [id]);
  await webhooks.deliverPartnerWebhooks({ orderId: id, send: failing.send, endpoints });
  await schema.pool.query("UPDATE partner_webhook_events SET claimed_at=claimed_at-interval '6 minutes' WHERE order_id=$1", [id]);
  await webhooks.deliverPartnerWebhooks({ orderId: id, send: failing.send, endpoints });
  assert.equal(failing.sent.length, 2);
  assert.deepEqual((await events(id)).map(row => [row.status, row.attempts]), [["pending", 2]]);
});

test("an event undelivered for 72 hours is given up; a partner without an endpoint is skipped", async () => {
  const id = await partnerOrder();
  await update(id, "status='confirmed'");
  await schema.pool.query("UPDATE partner_webhook_events SET created_at=now()-interval '73 hours',attempts=4,last_error='HTTP 500',claimed_at=now()-interval '3 hours' WHERE order_id=$1", [id]);
  const { sent, send } = recorder(204);
  assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: id, send, endpoints }), { delivered: 0, skipped: 0, dead: 1, retried: 0 });
  assert.equal(sent.length, 0);
  assert.deepEqual((await events(id)).map(row => [row.status, row.last_error]), [["dead", "gave up after 4 attempts: HTTP 500"]]);

  const other = await partnerOrder("other");
  await update(other, "status='confirmed'");
  assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: other, send, endpoints }), { delivered: 0, skipped: 1, dead: 0, retried: 0 });
  assert.equal(sent.length, 0);
  assert.deepEqual((await events(other)).map(row => [row.status, row.last_error]), [["skipped", "no endpoint configured"]]);
});

test("two concurrent deliveries send each event once", async () => {
  const ids = [await partnerOrder(), await partnerOrder()];
  for (const id of ids) { await update(id, "status='confirmed'"); await update(id, "status='cancelled',cancelled_by='admin',cancelled_at=now()"); }
  const mine = (await schema.pool.query<{ id: string }>("SELECT id::text FROM partner_webhook_events WHERE order_id=ANY($1::uuid[])", [ids])).rows.map(row => row.id);
  assert.equal(mine.length, 4);
  // The whole queue: the trigger tests' events are claimed too, so every send is counted.
  const { sent, send } = recorder(204, 50);
  const results = await Promise.all([webhooks.deliverPartnerWebhooks({ send, endpoints }), webhooks.deliverPartnerWebhooks({ send, endpoints })]);
  const sentIds = sent.map(request => request.headers["X-GetirBakim-Event-Id"]);
  assert.equal(new Set(sentIds).size, sentIds.length, "no event is sent twice");
  assert.equal(results[0].delivered + results[1].delivered, sentIds.length);
  for (const id of mine) assert.ok(sentIds.includes(id));
  for (const id of ids) assert.deepEqual((await events(id)).map(row => row.status), ["delivered", "delivered"]);
});

test("the admin summary counts waiting and given-up events per partner and lists the failing ones", async () => {
  const summary = await webhooks.partnerWebhookSummary(["bakimx", "other", "nobody"]);
  assert.ok((summary.get("bakimx")?.dead ?? 0) >= 1);
  assert.ok(summary.get("bakimx")?.lastDeliveredAt instanceof Date);
  assert.equal(summary.has("nobody"), false);
  const problems = await webhooks.recentPartnerWebhookProblems(["bakimx"]);
  assert.ok(problems.some(problem => problem.status === "dead"));
  assert.ok(problems.some(problem => problem.status === "pending" && problem.lastHttpStatus === 503));
  assert.ok(problems.every(problem => /^\d+$/.test(problem.orderNumber)));
});
