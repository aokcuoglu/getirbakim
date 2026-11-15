import assert from "node:assert/strict";
import crypto, { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { refundablePayments, reversalKinds } from "../src/modules/payments/refund-rules";

// TAMI void/refund from /yonetim (#619) in an isolated copy of the schema. Every TAMI reply is mocked and signed with a
// synthetic key; no provider request is made.
const K = Buffer.from("synthetic-refund-test-hmac-key-0123456789").toString("base64url");
const AUD = "test-merchant:test-terminal";
const env: Record<string, string> = {
  TAMI_MERCHANT_NUMBER: "test-merchant", TAMI_TERMINAL_NUMBER: "test-terminal", TAMI_SECRET_KEY: "synthetic-test-secret",
  TAMI_JWK_KID: "test-kid", TAMI_JWK_K: K,
  TAMI_PAYMENT_API_BASE_URL: "https://sandbox-paymentapi.tami.com.tr", TAMI_PORTAL_BASE_URL: "https://sandbox-portal.tami.com.tr",
};
const originalEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
Object.assign(process.env, env);

let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let tami: typeof import("../src/modules/payments/tami");
let refunds: typeof import("../src/modules/payments/refunds");
let orders: typeof import("../src/modules/admin/orders");
let closeDb: () => Promise<void>;
let admin = "";

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
const calls: Call[] = [];
let handler: (call: Call) => Response | Promise<Response> = () => { throw new Error("unexpected TAMI call"); };
const originalFetch = globalThis.fetch;

const b64 = (value: Buffer | string) => Buffer.from(value).toString("base64url");
const hmac = (key: string, input: string) => crypto.createHmac("sha512", Buffer.from(key, "base64url")).update(input, "utf8").digest();

function sign(body: Record<string, unknown>, { aud = AUD, exp = Math.floor(Date.now() / 1000) + 600, alg = "HS512", key = K } = {}) {
  const header = b64(JSON.stringify({ alg, typ: "JWT" }));
  const payload = b64(JSON.stringify({ iss: "tami", aud, exp, "tami:body": body }));
  return `${header}.${payload}.${b64(hmac(key, `${header}.${payload}`))}`;
}

/** Decrypts and verifies a signedRequest as TAMI would. */
function openRequest(token: string) {
  const parts = token.split(".");
  assert.equal(parts.length, 5); assert.equal(parts[1], "");
  const [jweHeader, , iv, cipherText, tag] = parts;
  assert.deepEqual(JSON.parse(Buffer.from(jweHeader, "base64url").toString()), { alg: "dir", enc: "A256GCM", cty: "JWT" });
  const key = crypto.createHash("sha256").update(Buffer.from(K, "base64url")).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(jweHeader, "ascii"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const jws = Buffer.concat([decipher.update(Buffer.from(cipherText, "base64url")), decipher.final()]).toString("utf8");
  const [header, payload, signature] = jws.split(".");
  assert.ok(crypto.timingSafeEqual(Buffer.from(signature, "base64url"), hmac(K, `${header}.${payload}`)));
  return { header: JSON.parse(Buffer.from(header, "base64url").toString()), claims: JSON.parse(Buffer.from(payload, "base64url").toString()) };
}
const requestBody = (call: Call) => openRequest(String(call.body.signedRequest)).claims["tami:body"] as Record<string, unknown>;

/** A signed success echoing the request (refund: its amount; void: no amount, like the documented reply). */
function approve(call: Call, overrides: Record<string, unknown> = {}) {
  const body = requestBody(call);
  return Response.json({ signedResponse: sign({
    success: true, systemTime: "2026-11-15T12:00:00", correlationId: call.headers.correlationid, transactionDate: "2026-11-15T12:00:00",
    currency: "TRY", bankAuthCode: "AUTH-1", bankReferenceNumber: `BANK-${body.orderId}`, ...(body.amount ? { amount: body.amount } : {}), ...overrides,
  }) });
}
const reject = (code = "1013", message = "İşlem yapılamaz.") =>
  Response.json({ success: false, systemTime: "2026-11-15T12:00:00", errorCode: code, errorMessage: message, errorGroup: "VALIDATION" }, { status: 400 });

function signedQuery(orderId: string, transactions: Array<Record<string, unknown>>, { forge = false } = {}) {
  const payload = { success: true, orderId, currency: "TRY", amount: 200, orderStatus: "AUTH", transactions };
  return Response.json({ ...payload, securityHash: forge ? "aaa.bbb.ccc" : tami.buildSecurityHash(payload) });
}
const authOk = { transactionType: "AUTH", transactionStatus: "SUCCESS", bankReferenceNumber: "AUTH-REF" };

before(async () => {
  schema = await isolatedSchema("payment_refunds_test");
  const [{ db }, tamiModule, refundModule, orderModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/payments/tami"),
    import("../src/modules/payments/refunds"), import("../src/modules/admin/orders")]);
  tami = tamiModule; refunds = refundModule; orders = orderModule;
  closeDb = () => db.end();
  admin = (await schema.pool.query<{ id: string }>("INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Yönetici',$1,'x','admin',true) RETURNING id::text",
    [`${randomUUID()}@example.invalid`])).rows[0].id;
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body ?? "{}")) };
    calls.push(call);
    return handler(call);
  };
});
after(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await closeDb?.(); await schema?.drop();
});

/** A cancelled (or paid) order with captured attempts of 200 TL; `sameDay` attempts were paid now, others two days ago. */
async function seed({ paymentStatus = "refund_required", attempts = 1, sameDay = false } = {}) {
  const order = (await schema.pool.query<{ id: string }>(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,customer_name,email,phone,address,
    total_kurus,subtotal_kurus,discount_percent,status,payment_status) VALUES('guest',$1,$2,'Test','t@example.invalid','5551234567','Test address',20000,20000,0,$3,$4)
    RETURNING id::text`, [randomUUID(), randomUUID(), paymentStatus === "paid" ? "pending" : "cancelled", paymentStatus])).rows[0].id;
  const payments: { id: string; provider: string }[] = [];
  for (let i = 0; i < attempts; i++) {
    const provider = `GB2-T-${randomUUID().slice(0, 12)}`;
    payments.push({ provider, id: (await schema.pool.query<{ id: string }>(`INSERT INTO commerce_payments(order_id,provider_order_id,amount_kurus,status,paid_at)
      VALUES($1,$2,20000,'succeeded',CASE WHEN $3 THEN now() ELSE now()-interval '2 days' END) RETURNING id::text`, [order, provider, sameDay])).rows[0].id });
  }
  return { order, payments };
}
const orderRow = async (id: string) => (await schema.pool.query("SELECT * FROM commerce_orders WHERE id=$1", [id])).rows[0];
const refundRows = async (order: string) => (await schema.pool.query("SELECT * FROM commerce_payment_refunds WHERE order_id=$1 ORDER BY requested_at,completed_at NULLS LAST", [order])).rows;
const refund = (order: string, payment: string) => refunds.refundPayment({ orderId: order, paymentId: payment, adminId: admin });

test("signedRequest is a dir/A256GCM JWE around an HS512 JWS with TAMI's v4 claims", () => {
  const token = tami.buildSignedRequest({ orderId: "GB2-1-1", amount: "10.00" });
  const { header, claims } = openRequest(token);
  assert.deepEqual(header, { alg: "HS512", kid: "test-kid", typ: "JWT" });
  assert.equal(claims.iss, AUD); assert.equal(claims.aud, "tami"); assert.equal(claims.exp - claims.iat, 600); assert.equal(claims.nbf, claims.iat);
  assert.match(claims.jti, /^[0-9a-f-]{36}$/);
  assert.deepEqual(claims["tami:body"], { orderId: "GB2-1-1", amount: "10.00" }); assert.equal(claims["tami:apiVersion"], "v4");
  assert.notEqual(tami.buildSignedRequest({ orderId: "x" }).split(".")[2], tami.buildSignedRequest({ orderId: "x" }).split(".")[2]);
});

test("signedResponse is accepted only with a valid HS512 signature, our audience and a live expiry", () => {
  assert.deepEqual(tami.decodeSignedResponse(sign({ success: true, amount: "10.00" })), { success: true, amount: "10.00" });
  // 60 s leeway after exp, as in TAMI's sample.
  assert.deepEqual(tami.decodeSignedResponse(sign({ success: true }, { exp: Math.floor(Date.now() / 1000) - 30 })), { success: true });
  const valid = sign({ success: true });
  for (const bad of [
    sign({ success: true }, { key: Buffer.from("another-key").toString("base64url") }),
    sign({ success: true }, { aud: "other-merchant:test-terminal" }),
    sign({ success: true }, { exp: Math.floor(Date.now() / 1000) - 120 }),
    sign({ success: true }, { alg: "HS256" }),
    `${valid}.x.y`, valid.split(".").slice(0, 2).join("."), "not-a-token",
  ]) assert.throws(() => tami.decodeSignedResponse(bad));
});

test("void only on the Istanbul day of payment; refundable attempts never leave a paid order without one", () => {
  const paid = new Date("2026-11-15T20:59:00Z"); // 23:59 in Istanbul
  assert.deepEqual(reversalKinds(paid, new Date("2026-11-15T20:59:59Z")), ["void", "refund"]);
  assert.deepEqual(reversalKinds(paid, new Date("2026-11-15T21:00:00Z")), ["refund"]);
  assert.deepEqual(reversalKinds(new Date("2026-11-14T21:00:00Z"), new Date("2026-11-15T20:59:59Z")), ["void", "refund"]);
  assert.deepEqual(reversalKinds(null), ["refund"]);
  const p = [{ id: "a", status: "succeeded" }, { id: "b", status: "succeeded" }, { id: "c", status: "abandoned" }];
  assert.deepEqual(refundablePayments({ payment_status: "refund_required" }, p, []).map(x => x.id), ["a", "b"]);
  assert.deepEqual(refundablePayments({ payment_status: "refund_required" }, p, [{ payment_id: "a", status: "failed" }, { payment_id: "b", status: "unknown" }]).map(x => x.id), ["a"]);
  assert.deepEqual(refundablePayments({ payment_status: "paid" }, p, []).map(x => x.id), ["a", "b"]);
  assert.deepEqual(refundablePayments({ payment_status: "paid" }, p, [{ payment_id: "a", status: "succeeded" }]), []);
  assert.deepEqual(refundablePayments({ payment_status: "paid" }, p, [{ payment_id: "a", status: "requested" }]), []);
  assert.deepEqual(refundablePayments({ payment_status: "paid" }, p.slice(0, 1), []), []);
  for (const status of ["refunded", "none", "awaiting", "expired"]) assert.deepEqual(refundablePayments({ payment_status: status }, p, []), []);
});

test("a verified refund marks the order refunded with the bank reference; nothing is sent twice", async () => {
  const { order, payments: [payment] } = await seed();
  calls.length = 0; handler = approve;
  const result = await refund(order, payment.id);
  assert.equal(result.outcome, "succeeded"); assert.equal(result.kind, "refund");
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.url, "https://sandbox-paymentapi.tami.com.tr/api/v0/payment/refund");
  assert.equal(call.headers["pg-api-version"], "v4");
  assert.match(call.headers["pg-auth-token"], /^test-merchant:test-terminal:/);
  assert.deepEqual(Object.keys(call.body), ["signedRequest"]);
  const body = requestBody(call);
  assert.equal(body.orderId, payment.provider); assert.equal(body.amount, "200.00"); assert.match(String(body.reason), /^Sipariş #\d+ iptal$/);
  const [row] = await refundRows(order);
  assert.equal(row.status, "succeeded"); assert.equal(row.kind, "refund"); assert.equal(row.correlation_id, call.headers.correlationid);
  assert.equal(row.bank_reference, `BANK-${payment.provider}`); assert.equal(row.requested_by, admin); assert.ok(row.completed_at);
  assert.equal(typeof row.provider_result.signedResponse, "string");
  const updated = await orderRow(order);
  assert.equal(updated.payment_status, "refunded"); assert.ok(updated.refunded_at instanceof Date);
  assert.equal(updated.refund_reference, `TAMI İade ${payment.provider} · banka ref. BANK-${payment.provider}`);
  assert.deepEqual(await refund(order, payment.id), { outcome: "not_allowed" });
  assert.equal(calls.length, 1);
});

test("same-day payments are voided first; a rejected void falls back to a refund in the same action", async () => {
  const { order, payments: [payment] } = await seed({ sameDay: true });
  calls.length = 0;
  handler = call => call.url.endsWith("/payment/void") ? reject("1050", "Gün sonu yapılmış işlem iptal edilemez.") : approve(call);
  const result = await refund(order, payment.id);
  assert.equal(result.outcome, "succeeded"); assert.equal(result.kind, "refund");
  assert.deepEqual(calls.map(c => c.url.split("/").pop()), ["void", "refund"]);
  assert.deepEqual(requestBody(calls[0]), { orderId: payment.provider, reason: requestBody(calls[1]).reason });
  assert.notEqual(calls[0].headers.correlationid, calls[1].headers.correlationid);
  const rows = await refundRows(order);
  assert.deepEqual(rows.map(r => [r.kind, r.status]), [["void", "failed"], ["refund", "succeeded"]]);
  assert.equal(rows[0].error_code, "1050"); assert.match(rows[0].error_message, /Gün sonu/);
  assert.equal((await orderRow(order)).payment_status, "refunded");

  // An accepted void settles it without a refund.
  const voided = await seed({ sameDay: true });
  calls.length = 0; handler = approve;
  assert.equal((await refund(voided.order, voided.payments[0].id)).kind, "void");
  assert.equal(calls.length, 1);
  assert.match((await orderRow(voided.order)).refund_reference, /^TAMI İptal /);
});

test("a definite rejection keeps the refund pending and allows a retry", async () => {
  const { order, payments: [payment] } = await seed();
  calls.length = 0; handler = () => reject("2001", "Yetersiz bakiye.");
  const failed = await refund(order, payment.id);
  assert.equal(failed.outcome, "failed"); assert.equal(failed.message, "Yetersiz bakiye.");
  assert.equal((await orderRow(order)).payment_status, "refund_required");
  // A signed rejection counts as definite too.
  handler = () => Response.json({ signedResponse: sign({ success: false, errorCode: 2002, errorMessage: "Reddedildi" }) });
  assert.equal((await refund(order, payment.id)).outcome, "failed");
  handler = approve;
  assert.equal((await refund(order, payment.id)).outcome, "succeeded");
  assert.deepEqual((await refundRows(order)).map(r => [r.status, r.error_code]), [["failed", "2001"], ["failed", "2002"], ["succeeded", null]]);
  assert.equal((await orderRow(order)).payment_status, "refunded");
});

test("an unanswered, unsigned or mismatching reply leaves the outcome unknown and locks new calls", async () => {
  const cases: Record<string, (call: Call) => Response | Promise<Response>> = {
    network: () => { throw new TypeError("fetch failed"); },
    server: () => Response.json({ success: false, errorCode: "9999", errorMessage: "Internal" }, { status: 500 }),
    html: () => new Response("<html>gateway</html>", { status: 502 }),
    unsignedOk: () => Response.json({ success: true, amount: "200.00" }),
    badSignature: () => Response.json({ signedResponse: sign({ success: true, amount: "200.00", currency: "TRY" }, { key: Buffer.from("x").toString("base64url") }) }),
    wrongAudience: call => Response.json({ signedResponse: sign({ success: true, amount: "200.00", correlationId: call.headers.correlationid }, { aud: "x:y" }) }),
    amount: call => approve(call, { amount: "199.99" }),
    currency: call => approve(call, { currency: "USD" }),
    correlation: call => approve(call, { correlationId: "someone-else" }),
    noAmount: call => approve(call, { amount: undefined }),
    missing: () => new Response("Not Found", { status: 404 }),
  };
  for (const [name, reply] of Object.entries(cases)) {
    const { order, payments: [payment] } = await seed();
    calls.length = 0; handler = reply;
    const result = await refund(order, payment.id);
    assert.equal(result.outcome, "unknown", name);
    const [row] = await refundRows(order);
    assert.equal(row.status, "unknown", name); assert.ok(row.error_message, name); assert.equal(row.completed_at, null, name);
    assert.equal((await orderRow(order)).payment_status, "refund_required", name);
    const sent = calls.length;
    handler = approve;
    const again = await refund(order, payment.id);
    assert.equal(again.outcome, "busy", name); assert.equal(calls.length, sent, name);
  }
  // A 404 on the documented path tries the unprefixed one once.
  const { order, payments: [payment] } = await seed();
  calls.length = 0;
  handler = call => call.url.includes("/api/v0/") ? new Response("Not Found", { status: 404 }) : approve(call);
  assert.equal((await refund(order, payment.id)).outcome, "succeeded");
  assert.deepEqual(calls.map(c => c.url.replace("https://sandbox-paymentapi.tami.com.tr", "")), ["/api/v0/payment/refund", "/payment/refund"]);
});

test("double clicks and parallel requests reach TAMI once", async () => {
  const { order, payments: [payment] } = await seed();
  calls.length = 0;
  handler = async call => { await new Promise(resolve => setTimeout(resolve, 100)); return approve(call); };
  const results = await Promise.all([refund(order, payment.id), refund(order, payment.id), refund(order, payment.id)]);
  assert.deepEqual(results.map(r => r.outcome).sort(), ["busy", "busy", "succeeded"]);
  assert.equal(calls.length, 1);
  assert.equal((await refundRows(order)).length, 1);
});

test("TAMI'de kontrol et settles an unknown call from the signed order query", async () => {
  const unknownCall = async () => {
    const seeded = await seed();
    handler = () => { throw new TypeError("fetch failed"); };
    assert.equal((await refund(seeded.order, seeded.payments[0].id)).outcome, "unknown");
    const [row] = await refundRows(seeded.order);
    return { ...seeded, refundId: row.id as string };
  };
  const age = (id: string, minutes: number) => schema.pool.query("UPDATE commerce_payment_refunds SET requested_at=now()-make_interval(mins=>$2) WHERE id=$1", [id, minutes]);
  const check = (order: string, refundId: string) => refunds.checkRefund({ refundId, orderId: order });

  // The query shows the reversal: succeeded, order refunded.
  const shown = await unknownCall();
  await age(shown.refundId, 5);
  handler = call => signedQuery(String(call.body.orderId), [authOk, { transactionType: "REFUND", transactionStatus: "SUCCESS", amount: 200, bankReferenceNumber: "Q-REF" }]);
  assert.equal((await check(shown.order, shown.refundId)).outcome, "succeeded");
  const settled = await orderRow(shown.order);
  assert.equal(settled.payment_status, "refunded"); assert.match(settled.refund_reference, /banka ref\. Q-REF/);
  assert.deepEqual(await check(shown.order, shown.refundId), { outcome: "not_allowed" });

  // Only the AUTH long after the call: nothing happened, retry allowed.
  const none = await unknownCall();
  await age(none.refundId, 20);
  handler = call => signedQuery(String(call.body.orderId), [authOk]);
  assert.equal((await check(none.order, none.refundId)).outcome, "failed");
  assert.equal((await refundRows(none.order))[0].status, "failed");
  handler = approve;
  assert.equal((await refund(none.order, none.payments[0].id)).outcome, "succeeded");

  // Stays unknown: too fresh to ask, AUTH only but recent, query down, forged signature, unrecognised transaction.
  const open = await unknownCall();
  calls.length = 0;
  assert.equal((await check(open.order, open.refundId)).outcome, "unknown");
  assert.equal(calls.length, 0);
  await age(open.refundId, 5);
  handler = call => signedQuery(String(call.body.orderId), [authOk]);
  assert.equal((await check(open.order, open.refundId)).outcome, "unknown");
  await age(open.refundId, 20);
  handler = () => { throw new TypeError("fetch failed"); };
  assert.equal((await check(open.order, open.refundId)).outcome, "unknown");
  handler = call => signedQuery(String(call.body.orderId), [authOk, { transactionType: "REFUND", transactionStatus: "SUCCESS", amount: 200 }], { forge: true });
  assert.equal((await check(open.order, open.refundId)).outcome, "unknown");
  handler = call => signedQuery(String(call.body.orderId), [authOk, { transactionType: "SOMETHING_NEW", transactionStatus: "SUCCESS" }]);
  assert.equal((await check(open.order, open.refundId)).outcome, "unknown");
  handler = call => signedQuery(String(call.body.orderId), [authOk, { transactionType: "REFUND", transactionStatus: "SUCCESS", amount: 150 }]);
  assert.equal((await check(open.order, open.refundId)).outcome, "unknown");
  const [row] = await refundRows(open.order);
  assert.equal(row.status, "unknown"); assert.ok(row.checked_at);
  assert.equal((await orderRow(open.order)).payment_status, "refund_required");
  // The refund id must belong to the order.
  assert.deepEqual(await check(none.order, open.refundId), { outcome: "not_allowed" });

  // Manual fallback: operations record the reference while the call is still unknown.
  assert.equal(await orders.recordOrderRefund(open.order, "PORTAL-REF-1"), true);
  const manual = await orderRow(open.order);
  assert.equal(manual.payment_status, "refunded"); assert.ok(manual.refunded_at instanceof Date); assert.equal(manual.refund_reference, "PORTAL-REF-1");
  assert.equal((await refundRows(open.order))[0].status, "unknown");
});

test("duplicate captures: extra attempts of a paid order are refunded, the last one stays", async () => {
  const { order, payments } = await seed({ paymentStatus: "paid", attempts: 2 });
  handler = approve;
  assert.equal((await refund(order, payments[1].id)).outcome, "succeeded");
  const row = await orderRow(order);
  assert.equal(row.payment_status, "paid"); assert.equal(row.refunded_at, null);
  assert.match(row.payment_note, new RegExp(`Mükerrer ödeme ${payments[1].provider} iade edildi\\.`));
  assert.match(String(requestBody(calls.at(-1)!).reason), /mükerrer ödeme/);
  assert.deepEqual(await refund(order, payments[0].id), { outcome: "not_allowed" });

  // A cancelled order with two captures is refunded once both are.
  const cancelled = await seed({ attempts: 2 });
  assert.equal((await refund(cancelled.order, cancelled.payments[0].id)).outcome, "succeeded");
  assert.equal((await orderRow(cancelled.order)).payment_status, "refund_required");
  assert.equal((await refund(cancelled.order, cancelled.payments[1].id)).outcome, "succeeded");
  const done = await orderRow(cancelled.order);
  assert.equal(done.payment_status, "refunded"); assert.ok(done.refunded_at);
  for (const p of cancelled.payments) assert.ok(done.refund_reference.includes(p.provider));
});

test("orders that are not awaiting a refund, and foreign attempts, are refused without a call", async () => {
  const paidOnce = await seed({ paymentStatus: "paid" });
  const other = await seed();
  calls.length = 0;
  assert.deepEqual(await refund(paidOnce.order, paidOnce.payments[0].id), { outcome: "not_allowed" });
  assert.deepEqual(await refund(paidOnce.order, other.payments[0].id), { outcome: "not_allowed" });
  assert.deepEqual(await refund(randomUUID(), other.payments[0].id), { outcome: "not_allowed" });
  await schema.pool.query("UPDATE commerce_payments SET status='abandoned' WHERE id=$1", [other.payments[0].id]);
  assert.deepEqual(await refund(other.order, other.payments[0].id), { outcome: "not_allowed" });
  assert.equal(calls.length, 0);
});

test("the refund schema is idempotent and allows one active call per attempt", async () => {
  const sql = await readFile("db/commerce.sql", "utf8");
  await schema.pool.query(sql); await schema.pool.query(sql);
  const { order, payments: [payment] } = await seed();
  const insert = (status: string) => schema.pool.query(
    "INSERT INTO commerce_payment_refunds(payment_id,order_id,kind,amount_kurus,status,correlation_id) VALUES($1,$2,'refund',20000,$3,$4)",
    [payment.id, order, status, randomUUID()]);
  await insert("failed"); await insert("failed"); await insert("unknown");
  await assert.rejects(insert("requested"), { code: "23505" });
  await assert.rejects(insert("succeeded"), { code: "23505" });
  await assert.rejects(insert("done"), { code: "23514" });
});
