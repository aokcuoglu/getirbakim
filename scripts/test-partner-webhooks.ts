import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import type { PartnerWebhookConfig } from "../src/modules/partner/webhook-contract";
import type { WebhookRequest } from "../src/modules/partner/webhooks";

// Partner webhook outbox (#1002) in an isolated copy of the schema: the triggers on commerce_orders and
// partner_return_requests, delivery, retries, the 72-hour give-up and concurrent claims. Sends are injected; nothing
// leaves the process.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let webhooks: typeof import("../src/modules/partner/webhooks");
let orders: typeof import("../src/modules/partner/orders");
let returns: typeof import("../src/modules/partner/returns");
let offerId: typeof import("../src/modules/partner/dto").encodeOfferId;
let closeDb: () => Promise<void>;

const secret = "test-webhook-secret-0123456789abcdef";
const config: PartnerWebhookConfig = { endpoints: new Map([["bakimx", { url: "https://bakimx.example.invalid/hooks", secret }]]), invalid: new Map(), parseError: false };

before(async () => {
  schema = await isolatedSchema("partner_webhooks_test");
  const [{ db }, webhookModule, ordersModule, returnsModule, dtoModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/partner/webhooks"),
    import("../src/modules/partner/orders"), import("../src/modules/partner/returns"), import("../src/modules/partner/dto")]);
  webhooks = webhookModule; orders = ordersModule; returns = returnsModule; offerId = dtoModule.encodeOfferId;
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
  assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: id, send, config }), { delivered: 2, skipped: 0, dead: 0, retried: 0 });
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
  assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: id, send, config }), { delivered: 0, skipped: 0, dead: 0, retried: 0 });
  assert.equal(sent.length, 2);
});

test("a non-2xx answer, a redirect or a network error keeps the event pending until the backoff has passed", async () => {
  for (const [answer, httpStatus, error] of [[500, 500, "HTTP 500"], [302, 302, "HTTP 302 (redirect not followed)"], [new Error("connect ECONNREFUSED"), null, "connect ECONNREFUSED"]] as const) {
    const id = await partnerOrder();
    await update(id, "status='confirmed'");
    const failing = recorder(answer);
    assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: id, send: failing.send, config }), { delivered: 0, skipped: 0, dead: 0, retried: 1 });
    assert.deepEqual((await events(id)).map(row => [row.status, row.attempts, row.last_http_status, row.last_error]), [["pending", 1, httpStatus, error]]);
    // Within the 5-minute backoff the event is not claimed again.
    const ok = recorder(204);
    assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: id, send: ok.send, config }), { delivered: 0, skipped: 0, dead: 0, retried: 0 });
    assert.equal(ok.sent.length, 0);
    await schema.pool.query("UPDATE partner_webhook_events SET claimed_at=claimed_at-interval '6 minutes' WHERE order_id=$1", [id]);
    assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: id, send: ok.send, config }), { delivered: 1, skipped: 0, dead: 0, retried: 0 });
    assert.deepEqual((await events(id)).map(row => [row.status, row.attempts, row.last_http_status, row.last_error]), [["delivered", 2, 204, null]]);
  }
  // The second failure waits 15 minutes, not 5.
  const id = await partnerOrder();
  await update(id, "status='confirmed'");
  const failing = recorder(503);
  await webhooks.deliverPartnerWebhooks({ orderId: id, send: failing.send, config });
  await schema.pool.query("UPDATE partner_webhook_events SET claimed_at=claimed_at-interval '6 minutes' WHERE order_id=$1", [id]);
  await webhooks.deliverPartnerWebhooks({ orderId: id, send: failing.send, config });
  await schema.pool.query("UPDATE partner_webhook_events SET claimed_at=claimed_at-interval '6 minutes' WHERE order_id=$1", [id]);
  await webhooks.deliverPartnerWebhooks({ orderId: id, send: failing.send, config });
  assert.equal(failing.sent.length, 2);
  assert.deepEqual((await events(id)).map(row => [row.status, row.attempts]), [["pending", 2]]);
});

test("the first retry comes after 4 minutes, so it lands on the next 5-minute sweep", async () => {
  const id = await partnerOrder();
  await update(id, "status='confirmed'");
  await webhooks.deliverPartnerWebhooks({ orderId: id, send: recorder(500).send, config });
  await schema.pool.query("UPDATE partner_webhook_events SET claimed_at=claimed_at-interval '3 minutes 50 seconds' WHERE order_id=$1", [id]);
  const ok = recorder(204);
  await webhooks.deliverPartnerWebhooks({ orderId: id, send: ok.send, config });
  assert.equal(ok.sent.length, 0);
  await schema.pool.query("UPDATE partner_webhook_events SET claimed_at=claimed_at-interval '15 seconds' WHERE order_id=$1", [id]);
  await webhooks.deliverPartnerWebhooks({ orderId: id, send: ok.send, config });
  assert.equal(ok.sent.length, 1);
});

test("a fetch TypeError keeps only its cause's code next to the message", async () => {
  const id = await partnerOrder();
  await update(id, "status='confirmed'");
  const error = new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), { code: "ECONNREFUSED" }) });
  await webhooks.deliverPartnerWebhooks({ orderId: id, send: recorder(error).send, config });
  assert.deepEqual((await events(id)).map(row => [row.status, row.last_http_status, row.last_error]), [["pending", null, "fetch failed (ECONNREFUSED)"]]);
});

test("a broken or disabled entry and broken JSON keep events pending; only a partner without an entry is skipped", async () => {
  const id = await partnerOrder();
  await update(id, "status='confirmed'");
  const { sent, send } = recorder(204);
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    for (const reason of ["disabled", "URL is not https"]) {
      const held: PartnerWebhookConfig = { endpoints: new Map(), invalid: new Map([["bakimx", reason]]), parseError: false };
      assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: id, send, config: held }), { delivered: 0, skipped: 0, dead: 0, retried: 0 });
      assert.ok(errors.some(args => JSON.stringify(args).includes(reason) && JSON.stringify(args).includes("bakimx")), reason);
    }
    errors.length = 0;
    assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: id, send, config: { endpoints: new Map(), invalid: new Map(), parseError: true } }),
      { delivered: 0, skipped: 0, dead: 0, retried: 0 });
    assert.equal(errors.length, 1);
    assert.ok(!JSON.stringify(errors).includes(secret));
  } finally { console.error = original; }
  assert.equal(sent.length, 0);
  // Untouched: no attempt counted and no claim, so a fixed configuration sends it at once.
  assert.deepEqual((await events(id)).map(row => [row.status, row.attempts]), [["pending", 0]]);
  assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: id, send, config }), { delivered: 1, skipped: 0, dead: 0, retried: 0 });
  // Still given up after 72 hours while the configuration stays broken.
  const late = await partnerOrder();
  await update(late, "status='confirmed'");
  await schema.pool.query("UPDATE partner_webhook_events SET created_at=now()-interval '73 hours' WHERE order_id=$1", [late]);
  console.error = () => undefined;
  try {
    assert.equal((await webhooks.deliverPartnerWebhooks({ orderId: late, send, config: { endpoints: new Map(), invalid: new Map(), parseError: true } })).dead, 1);
  } finally { console.error = original; }
});

test("an event undelivered for 72 hours is given up; a partner without an endpoint is skipped", async () => {
  const id = await partnerOrder();
  await update(id, "status='confirmed'");
  await schema.pool.query("UPDATE partner_webhook_events SET created_at=now()-interval '73 hours',attempts=4,last_error='HTTP 500',claimed_at=now()-interval '3 hours' WHERE order_id=$1", [id]);
  const { sent, send } = recorder(204);
  assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: id, send, config }), { delivered: 0, skipped: 0, dead: 1, retried: 0 });
  assert.equal(sent.length, 0);
  assert.deepEqual((await events(id)).map(row => [row.status, row.last_error]), [["dead", "gave up after 4 attempts: HTTP 500"]]);

  const other = await partnerOrder("other");
  await update(other, "status='confirmed'");
  assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: other, send, config }), { delivered: 0, skipped: 1, dead: 0, retried: 0 });
  assert.equal(sent.length, 0);
  assert.deepEqual((await events(other)).map(row => [row.status, row.last_error]), [["skipped", "no endpoint configured"]]);
});

/** A delivered partner order with a pending return request (through the partner API) for its one line. */
async function returnRequest() {
  const id = await partnerOrder();
  await update(id, "status='shipped',shipped_at=now(),carrier='yurtici',tracking_no='777'");
  await update(id, "status='delivered',delivered_at=now()");
  const productId = (await schema.pool.query<{ product_id: string }>("SELECT product_id::text FROM commerce_order_items WHERE order_id=$1", [id])).rows[0].product_id;
  const created = await returns.requestPartnerReturn("bakimx", id, randomUUID(), { lines: [{ selectedOfferId: offerId(productId), quantity: 1, reason: "defective" }], note: "Kutusu hasarlı" });
  return { orderId: id, requestId: created.return.id };
}
const returnEvents = async (orderId: string) => (await schema.pool.query<{ id: string; return_request_id: string | null; order_status: string; status: string; last_error: string | null }>(
  `SELECT id::text,return_request_id::text,order_status,status,last_error FROM partner_webhook_events
   WHERE order_id=$1 AND event_type='partner.return.updated' ORDER BY created_at,id`, [orderId])).rows;

test("a return request writes no event; its approval or rejection writes one partner.return.updated row", async () => {
  for (const decision of ["approve", "reject"] as const) {
    const { orderId, requestId } = await returnRequest();
    assert.deepEqual(await returnEvents(orderId), [], "the partner's own POST answer carries the new request");
    assert.equal(await returns.decidePartnerReturnRequest(requestId, decision, null), true);
    assert.deepEqual((await returnEvents(orderId)).map(row => [row.return_request_id, row.order_status, row.status]), [[requestId, "delivered", "pending"]], decision);
    // A second decision is refused and writes nothing more.
    assert.equal(await returns.decidePartnerReturnRequest(requestId, decision, null), false);
    assert.equal((await returnEvents(orderId)).length, 1);
  }
});

test("a return event delivers the request as it is now, signed, with the return event type", async () => {
  const { orderId, requestId } = await returnRequest();
  await returns.decidePartnerReturnRequest(requestId, "approve", null);
  const { sent, send } = recorder(204);
  // Only this order's events: its two order events and the return event.
  assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId, send, config }), { delivered: 3, skipped: 0, dead: 0, retried: 0 });
  const [event] = await returnEvents(orderId);
  assert.equal(event.status, "delivered");
  const request = sent.find(item => item.headers["X-GetirBakim-Event-Id"] === event.id);
  assert.ok(request);
  assert.equal(request.headers["X-GetirBakim-Event-Type"], "partner.return.updated");
  const timestamp = request.headers["X-GetirBakim-Timestamp"];
  assert.equal(request.headers["X-GetirBakim-Signature"], `v1=${createHmac("sha256", secret).update(`${timestamp}.${request.body}`).digest("hex")}`);
  const body = JSON.parse(request.body);
  assert.deepEqual(Object.keys(body), ["specVersion", "eventId", "eventType", "occurredAt", "partnerId", "return"]);
  assert.deepEqual([body.specVersion, body.eventId, body.eventType, body.partnerId], ["1.0", event.id, "partner.return.updated", "bakimx"]);
  assert.deepEqual(body.return, JSON.parse(JSON.stringify(await returns.readPartnerReturn("bakimx", requestId))));
  assert.equal(body.return.status, "APPROVED");
  assert.equal(body.return.contractVersion, "2.1");
  for (const internal of ["BASBUG", `"nf"`, "basbug", "fingerprint", secret]) assert.ok(!request.body.includes(internal), internal);
  assert.equal(sent.filter(item => item.headers["X-GetirBakim-Event-Type"] === "partner.order.updated").length, 2);
});

test("a return event whose request is gone is skipped; another partner cannot read the request", async () => {
  const { orderId, requestId } = await returnRequest();
  await returns.decidePartnerReturnRequest(requestId, "reject", null);
  assert.equal(await returns.readPartnerReturn("other", requestId), null);
  // The foreign key cascades a deleted request, so a vanished one is simulated on the event.
  await schema.pool.query("UPDATE partner_webhook_events SET return_request_id=NULL WHERE order_id=$1 AND event_type='partner.return.updated'", [orderId]);
  const { sent, send } = recorder(204);
  assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId, send, config }), { delivered: 2, skipped: 1, dead: 0, retried: 0 });
  assert.deepEqual((await returnEvents(orderId)).map(row => [row.status, row.last_error]), [["skipped", "return request not found"]]);
  assert.ok(sent.every(item => item.headers["X-GetirBakim-Event-Type"] === "partner.order.updated"));
});

test("an order's delivery sends only that order's events", async () => {
  const mine = await partnerOrder();
  const other = await partnerOrder();
  await update(mine, "status='confirmed'");
  await update(other, "status='confirmed'");
  const { sent, send } = recorder(204);
  assert.deepEqual(await webhooks.deliverPartnerWebhooks({ orderId: mine, send, config }), { delivered: 1, skipped: 0, dead: 0, retried: 0 });
  assert.deepEqual(sent.map(item => JSON.parse(item.body).order.id), [mine]);
  assert.deepEqual((await events(other)).map(row => row.status), ["pending"]);
});

test("operations steps and carrier updates send the order's partner webhooks right after their answer", async () => {
  const actions = await readFile("src/modules/admin/commerce-actions.ts", "utf8");
  const revalidate = actions.slice(actions.indexOf("function revalidateOrder("), actions.indexOf("\n}", actions.indexOf("function revalidateOrder(")));
  assert.match(revalidate, /after\(\(\)=>deliverPartnerWebhooksSafely\(\{orderId:id\}\)\)/);
  const geliver = await readFile("src/app/api/shipping/geliver/webhook/route.ts", "utf8");
  const applied = geliver.slice(geliver.indexOf('if (result.outcome === "applied")'), geliver.indexOf("return NextResponse.json"));
  assert.match(applied, /after\(\(\) => deliverPartnerWebhooksSafely\(\{ orderId: result\.orderId \}\)\)/);
});

test("two concurrent deliveries send each event once", async () => {
  const ids = [await partnerOrder(), await partnerOrder()];
  for (const id of ids) { await update(id, "status='confirmed'"); await update(id, "status='cancelled',cancelled_by='admin',cancelled_at=now()"); }
  const mine = (await schema.pool.query<{ id: string }>("SELECT id::text FROM partner_webhook_events WHERE order_id=ANY($1::uuid[])", [ids])).rows.map(row => row.id);
  assert.equal(mine.length, 4);
  // The whole queue: the trigger tests' events are claimed too, so every send is counted.
  const { sent, send } = recorder(204, 50);
  const results = await Promise.all([webhooks.deliverPartnerWebhooks({ send, config }), webhooks.deliverPartnerWebhooks({ send, config })]);
  const sentIds = sent.map(request => request.headers["X-GetirBakim-Event-Id"]);
  assert.equal(new Set(sentIds).size, sentIds.length, "no event is sent twice");
  assert.equal(results[0].delivered + results[1].delivered, sentIds.length);
  for (const id of mine) assert.ok(sentIds.includes(id));
  for (const id of ids) assert.deepEqual((await events(id)).map(row => row.status), ["delivered", "delivered"]);
});

test("the admin summary counts waiting and given-up events per partner and lists the failing ones", async () => {
  const summary = await webhooks.partnerWebhookSummary(["bakimx", "other", "nobody"]);
  assert.ok((summary.get("bakimx")?.dead ?? 0) >= 1);
  assert.equal(summary.get("other")?.skipped, 1);
  assert.ok(summary.get("bakimx")?.lastDeliveredAt instanceof Date);
  assert.equal(summary.has("nobody"), false);
  const problems = await webhooks.recentPartnerWebhookProblems(["bakimx"]);
  assert.ok(problems.some(problem => problem.status === "dead"));
  assert.ok(problems.some(problem => problem.status === "pending" && problem.lastHttpStatus === 503));
  assert.ok(problems.every(problem => /^\d+$/.test(problem.orderNumber)));
});
