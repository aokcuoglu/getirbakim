import assert from "node:assert/strict";
import crypto, { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { istanbulLocalTime, refundablePayments, reversalKind } from "../src/modules/payments/refund-rules";

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
let checkout: typeof import("../src/modules/payments/checkout");
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
  const [{ db }, tamiModule, refundModule, orderModule, checkoutModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/payments/tami"),
    import("../src/modules/payments/refunds"), import("../src/modules/admin/orders"), import("../src/modules/payments/checkout")]);
  tami = tamiModule; refunds = refundModule; orders = orderModule; checkout = checkoutModule;
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

test("void only on the Istanbul day of payment and before a rejected void; refundable attempts never leave a paid order without one", () => {
  const paid = new Date("2026-11-15T20:59:00Z"); // 23:59 in Istanbul
  assert.equal(reversalKind(paid, [], new Date("2026-11-15T20:59:59Z")), "void");
  assert.equal(reversalKind(paid, [], new Date("2026-11-15T21:00:00Z")), "refund");
  assert.equal(reversalKind(new Date("2026-11-14T21:00:00Z"), [], new Date("2026-11-15T20:59:59Z")), "void");
  assert.equal(reversalKind(paid, [{ kind: "void", status: "failed" }], new Date("2026-11-15T20:59:59Z")), "refund");
  assert.equal(reversalKind(paid, [{ kind: "refund", status: "failed" }], new Date("2026-11-15T20:59:59Z")), "void");
  assert.equal(reversalKind(null), "refund");
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

test("same-day payments are voided; a rejected void is refunded only on the next deliberate action", async () => {
  const { order, payments: [payment] } = await seed({ sameDay: true });
  calls.length = 0;
  handler = call => call.url.endsWith("/payment/void") ? reject("1050", "Gün sonu yapılmış işlem iptal edilemez.") : approve(call);
  assert.deepEqual(await refund(order, payment.id), { outcome: "failed", kind: "void", message: "Gün sonu yapılmış işlem iptal edilemez." });
  assert.deepEqual(calls.map(c => c.url.split("/").pop()), ["void"]);
  assert.deepEqual(requestBody(calls[0]), { orderId: payment.provider, reason: requestBody(calls[0]).reason });
  assert.equal((await orderRow(order)).payment_status, "refund_required");
  // The second click sends a refund.
  const second = await refund(order, payment.id);
  assert.equal(second.outcome, "succeeded"); assert.equal(second.kind, "refund");
  assert.deepEqual(calls.map(c => c.url.split("/").pop()), ["void", "refund"]);
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

  // A void without an answer: one call, no refund, and the attempt stays locked.
  const lost = await seed({ sameDay: true });
  calls.length = 0; handler = () => { throw new TypeError("fetch failed"); };
  assert.deepEqual(await refund(lost.order, lost.payments[0].id), { outcome: "unknown", kind: "void", message: "TAMI yanıt vermedi (ağ hatası veya zaman aşımı)." });
  handler = approve;
  assert.equal((await refund(lost.order, lost.payments[0].id)).outcome, "busy");
  assert.deepEqual(calls.map(c => c.url.split("/").pop()), ["void"]);
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
    timeout408: () => Response.json({ success: false, errorCode: "408", errorMessage: "Timeout" }, { status: 408 }),
    conflict409: () => Response.json({ success: false, errorCode: "409", errorMessage: "Conflict" }, { status: 409 }),
    early425: () => Response.json({ success: false, errorCode: "425", errorMessage: "Too early" }, { status: 425 }),
    throttled429: () => Response.json({ success: false, errorCode: "429", errorMessage: "Too many" }, { status: 429 }),
    noCorrelation: call => approve(call, { correlationId: undefined }),
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
  // A TAMI error body on 404 is an answer from the endpoint: no second path, a definite rejection.
  const answered = await seed();
  calls.length = 0;
  handler = () => Response.json({ success: false, errorCode: "2013", errorMessage: "Bu sipariş üye işyerine ait değildir." }, { status: 404 });
  assert.equal((await refund(answered.order, answered.payments[0].id)).outcome, "failed");
  assert.equal(calls.length, 1); assert.ok(calls[0].url.includes("/api/v0/"));
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

/** TAMI's transactionDate: Istanbul wall time without an offset. */
const istanbulAt = (offsetMs = 0) => new Date(Date.now() + offsetMs + 3 * 3_600_000).toISOString().replace("Z", "").replace(/\.(\d{3})$/, ".$1123");
// The shapes observed in the sandbox (GB2-36-1, 15 Nov 2026).
const reversalTx = (type: "REVERSE" | "REFUND", status: "SUCCESS" | "FAIL", { amount = 200 as number | null, at = istanbulAt(), ref = "631909196255" } = {}) => ({
  ...(amount === null ? {} : { amount }), transactionType: type, fraudStatus: false, transactionStatus: status, transactionDate: at, bankReferenceNumber: ref,
});

test("TAMI's Istanbul transaction time is read as UTC+3", () => {
  assert.equal(istanbulLocalTime("2026-11-15T10:04:19.595942")?.toISOString(), "2026-11-15T07:04:19.595Z");
  assert.equal(istanbulLocalTime("2026-11-15T00:30:00")?.toISOString(), "2026-11-14T21:30:00.000Z");
  for (const bad of ["2026-11-15T10:04:19Z", "2026-11-15", "", null, 1731654259]) assert.equal(istanbulLocalTime(bad), null);
});

test("TAMI'de kontrol et settles an unknown call from the signed order query", async () => {
  const unknownCall = async () => {
    const seeded = await seed();
    handler = () => { throw new TypeError("fetch failed"); };
    assert.equal((await refund(seeded.order, seeded.payments[0].id)).outcome, "unknown");
    const [row] = await refundRows(seeded.order);
    await age(row.id, 5);
    return { ...seeded, refundId: row.id as string };
  };
  const age = (id: string, minutes: number) => schema.pool.query("UPDATE commerce_payment_refunds SET requested_at=now()-make_interval(mins=>$2) WHERE id=$1", [id, minutes]);
  const check = (order: string, refundId: string) => refunds.checkRefund({ refundId, orderId: order });
  const query = (transactions: Array<Record<string, unknown>>, options?: { forge?: boolean }) => (call: Call) => signedQuery(String(call.body.orderId), transactions, options);

  // A successful REFUND after the call: succeeded, order refunded.
  const shown = await unknownCall();
  handler = query([authOk, reversalTx("REFUND", "SUCCESS", { ref: "Q-REF" })]);
  assert.equal((await check(shown.order, shown.refundId)).outcome, "succeeded");
  const settled = await orderRow(shown.order);
  assert.equal(settled.payment_status, "refunded"); assert.match(settled.refund_reference, /banka ref\. Q-REF/);
  assert.equal(JSON.stringify((await refundRows(shown.order))[0].provider_result).includes("securityHash"), false);
  assert.deepEqual(await check(shown.order, shown.refundId), { outcome: "not_allowed" });

  // Only a FAIL of this call: failed, and a new call is allowed.
  const failed = await unknownCall();
  handler = query([authOk, reversalTx("REFUND", "FAIL")]);
  assert.equal((await check(failed.order, failed.refundId)).outcome, "failed");
  assert.equal((await refundRows(failed.order))[0].status, "failed");
  handler = approve;
  assert.equal((await refund(failed.order, failed.payments[0].id)).outcome, "succeeded");

  // A FAIL and a SUCCESS of this call: the SUCCESS wins.
  const both = await unknownCall();
  handler = query([authOk, reversalTx("REFUND", "FAIL"), reversalTx("REFUND", "SUCCESS")]);
  assert.equal((await check(both.order, both.refundId)).outcome, "succeeded");

  // Stays unknown: too fresh to ask, nothing matching yet, query down, forged signature.
  const open = await unknownCall();
  await age(open.refundId, 0);
  calls.length = 0;
  assert.equal((await check(open.order, open.refundId)).outcome, "unknown");
  assert.equal(calls.length, 0);
  await age(open.refundId, 5);
  for (const [name, reply] of Object.entries({
    authOnly: query([authOk]),
    otherKind: query([authOk, reversalTx("REVERSE", "SUCCESS")]),
    otherAmount: query([authOk, reversalTx("REFUND", "SUCCESS", { amount: 150 })]),
    noAmount: query([authOk, reversalTx("REFUND", "SUCCESS", { amount: null })]),
    beforeTheCall: query([authOk, reversalTx("REFUND", "SUCCESS", { at: istanbulAt(-10 * 60_000) }), reversalTx("REFUND", "FAIL", { at: istanbulAt(-6 * 60_000) })]),
    zonedDate: query([authOk, reversalTx("REFUND", "SUCCESS", { at: new Date().toISOString() })]),
    forged: query([authOk, reversalTx("REFUND", "SUCCESS")], { forge: true }),
    down: () => { throw new TypeError("fetch failed"); },
  })) {
    handler = reply;
    assert.equal((await check(open.order, open.refundId)).outcome, "unknown", name);
  }
  const [row] = await refundRows(open.order);
  assert.equal(row.status, "unknown"); assert.ok(row.checked_at);
  assert.equal((await orderRow(open.order)).payment_status, "refund_required");
  assert.equal((await refund(open.order, open.payments[0].id)).outcome, "busy");
  // The refund id must belong to the order.
  assert.deepEqual(await check(failed.order, open.refundId), { outcome: "not_allowed" });

  // A FAIL of an earlier, already failed call of the same attempt does not settle the new one.
  const retried = await seed();
  handler = () => reject("30028", "Banka tarafında işlemin onaylanmadı. TAMI-28802");
  assert.equal((await refund(retried.order, retried.payments[0].id)).outcome, "failed");
  handler = () => { throw new TypeError("fetch failed"); };
  assert.equal((await refund(retried.order, retried.payments[0].id)).outcome, "unknown");
  const [first, second] = await refundRows(retried.order);
  await schema.pool.query("UPDATE commerce_payment_refunds SET requested_at=now()-interval '10 minutes',completed_at=now()-interval '9 minutes' WHERE id=$1", [first.id]);
  await age(second.id, 5);
  handler = query([authOk, reversalTx("REFUND", "FAIL", { at: istanbulAt(-9.5 * 60_000) })]);
  assert.equal((await check(retried.order, second.id)).outcome, "unknown");

  // Manual fallback: operations record the reference while the call is still unknown.
  assert.equal(await orders.recordOrderRefund(open.order, "PORTAL-REF-1"), true);
  const manual = await orderRow(open.order);
  assert.equal(manual.payment_status, "refunded"); assert.ok(manual.refunded_at instanceof Date); assert.equal(manual.refund_reference, "PORTAL-REF-1");
  assert.equal((await refundRows(open.order))[0].status, "unknown");
});

test("after a refund recorded by hand, a late capture is the only attempt left to refund", async () => {
  const { order, payments: [first] } = await seed();
  assert.equal(await orders.recordOrderRefund(order, "PORTAL-REF-9"), true);
  const late = `GB2-T-${randomUUID().slice(0, 12)}`;
  const lateId = (await schema.pool.query<{ id: string }>("INSERT INTO commerce_payments(order_id,provider_order_id,amount_kurus,status) VALUES($1,$2,20000,'pending') RETURNING id::text",
    [order, late])).rows[0].id;
  handler = call => signedQuery(String(call.body.orderId), [authOk]);
  await checkout.reconcileOrderPayments(order);
  const reopened = await orderRow(order);
  assert.equal(reopened.payment_status, "refund_required");
  const payments = (await schema.pool.query("SELECT id::text,status,paid_at FROM commerce_payments WHERE order_id=$1", [order])).rows;
  assert.deepEqual(refundablePayments(reopened, payments, []).map(p => p.id), [lateId]);
  calls.length = 0; handler = approve;
  assert.deepEqual(await refund(order, first.id), { outcome: "not_allowed" });
  assert.equal(calls.length, 0);
  assert.equal((await refund(order, lateId)).outcome, "succeeded");
  const done = await orderRow(order);
  assert.equal(done.payment_status, "refunded");
  assert.equal(done.refund_reference, `PORTAL-REF-9; TAMI İptal ${late} · banka ref. BANK-${late}`);
});

test("missing TAMI settings: nothing is recorded or sent", async () => {
  const { order, payments: [payment] } = await seed();
  const key = process.env.TAMI_JWK_K;
  delete process.env.TAMI_JWK_K;
  calls.length = 0;
  try {
    assert.equal((await refund(order, payment.id)).outcome, "unavailable");
    assert.equal((await refunds.checkRefund({ refundId: randomUUID(), orderId: order })).outcome, "unavailable");
  } finally { process.env.TAMI_JWK_K = key; }
  assert.equal(calls.length, 0);
  assert.equal((await refundRows(order)).length, 0);
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

test("a capture arriving after the order was refunded reopens the refund step", async () => {
  const { order, payments: [payment] } = await seed();
  handler = approve;
  assert.equal((await refund(order, payment.id)).outcome, "succeeded");
  const late = `GB2-T-${randomUUID().slice(0, 12)}`;
  const lateId = (await schema.pool.query<{ id: string }>("INSERT INTO commerce_payments(order_id,provider_order_id,amount_kurus,status) VALUES($1,$2,20000,'pending') RETURNING id::text",
    [order, late])).rows[0].id;
  handler = call => signedQuery(String(call.body.orderId), [authOk]);
  await checkout.reconcileOrderPayments(order);
  const row = await orderRow(order);
  assert.equal(row.payment_status, "refund_required");
  assert.match(row.payment_note, new RegExp(`İade edilmiş siparişe yeni ödeme alındı \\(${late}\\)`));
  handler = approve;
  assert.equal((await refund(order, lateId)).outcome, "succeeded");
  assert.equal((await orderRow(order)).payment_status, "refunded");
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
