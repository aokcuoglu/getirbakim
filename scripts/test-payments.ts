import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

// Every TAMI response below is mocked and signed with a synthetic key; no provider request is made.
test("prepaid checkout: hosted attempts, signed reconciliation, expiry, late and duplicate payments", async () => {
  const originalUrl = process.env.DATABASE_URL!;
  const root = new Pool({ connectionString: originalUrl });
  const control = await root.connect();
  const namespace = `payment_test_${randomBytes(8).toString("hex")}`;
  await control.query(`CREATE SCHEMA ${namespace}`);
  const testUrl = new URL(originalUrl); testUrl.searchParams.set("options", `-c search_path=${namespace}`);
  const env: Record<string, string> = {
    DATABASE_URL: testUrl.toString(), TAMI_CHECKOUT_ENABLED: "true", SITE_URL: "https://shop.example.invalid",
    TAMI_MERCHANT_NUMBER: "test-merchant", TAMI_TERMINAL_NUMBER: "test-terminal", TAMI_SECRET_KEY: "synthetic-test-secret",
    TAMI_JWK_KID: "test-kid", TAMI_JWK_K: Buffer.from("synthetic-test-hmac-key").toString("base64url"),
    TAMI_PAYMENT_API_BASE_URL: "https://sandbox-paymentapi.tami.com.tr", TAMI_PORTAL_BASE_URL: "https://sandbox-portal.tami.com.tr",
  };
  const originalEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const { db } = await import("../src/lib/db");
  const { submitOrder, cartQuote, shippingRule, orderTotals } = await import("../src/modules/store/orders");
  const { cartFor, setCartQuantity } = await import("../src/modules/store/cart");
  const payments = await import("../src/modules/payments/checkout");
  const { buildSecurityHash } = await import("../src/modules/payments/tami");
  const originalFetch = globalThis.fetch;
  const paid = new Map<string, number>(); // provider orderId -> amount in TL
  const incomplete = new Set<string>(); // sandbox-observed shape of a declined/abandoned 3D attempt
  let tokens = 0, queryDown = false, forgeMissing = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input), body = JSON.parse(String(init?.body ?? "{}"));
    if (url.endsWith("/hosted/create-one-time-hosted-token")) {
      tokens++;
      assert.match(body.mobilePhoneNumber, /^90\d{10}$/);
      assert.equal(body.successCallbackUrl, payments.callbackUrl(String(body.successCallbackUrl.match(/order=([^&]+)/)[1])));
      return Response.json({ oneTimeToken: `token-${tokens}`, tokenCreateTime: "2026-10-09T12:00:00" });
    }
    if (queryDown) throw new Error("network down");
    if (incomplete.has(body.orderId)) {
      const payload = { success: true, orderId: body.orderId, currency: "TRY", amount: 10, orderStatus: "AUTH", paymentStatus: "NOT_COMPLETED",
        transactions: [{ transactionType: "AUTH", transactionStatus: "NOT_COMPLETED" }] };
      return Response.json({ ...payload, securityHash: buildSecurityHash(payload) });
    }
    const amount = paid.get(body.orderId);
    if (amount === undefined) {
      const payload = { errorMessage: "Bu sipariş üye işyerine ait değildir.", success: false, errorCode: 2013 };
      return Response.json({ ...payload, securityHash: forgeMissing ? "aaa.bbb.ccc" : buildSecurityHash(payload) }, { status: 400 });
    }
    const payload = { success: true, orderId: body.orderId, currency: "TRY", amount, orderStatus: "AUTH", installmentCount: 1,
      transactions: [{ transactionType: "AUTH", transactionStatus: "SUCCESS", bankReferenceNumber: `REF-${body.orderId}`, bankAuthCode: "123456" }] };
    return Response.json({ ...payload, securityHash: buildSecurityHash(payload) });
  };
  try {
    await db.query(await readFile("db/schema.sql", "utf8"));
    const commerceSql = await readFile("db/commerce.sql", "utf8");
    await db.query(commerceSql); await db.query(commerceSql);
    await db.query("UPDATE commerce_settings SET shipping_fee_kurus=15000,free_shipping_threshold_kurus=150000");
    const product = (await db.query<{ id: string }>("INSERT INTO products(supplier,code,name,brand,price_kurus,stock) VALUES('demo','PAY-1','Payment part','TEST',10000,5) RETURNING id")).rows[0].id;
    const stock = async () => (await db.query<{ stock: number }>("SELECT stock FROM products WHERE id=$1", [product])).rows[0].stock;
    const order = async (id: string) => (await db.query("SELECT * FROM commerce_orders WHERE id=$1", [id])).rows[0];

    const owner = { kind: "guest" as const, id: randomBytes(32).toString("hex") };
    await db.query("INSERT INTO guest_carts(token_hash) VALUES($1)", [owner.id]);
    const place = async (quantity: number) => {
      assert.equal(await setCartQuantity(owner, product, quantity), true);
      const items = await cartFor(owner), shipping = await shippingRule();
      const result = await submitOrder(owner, { requestKey: randomUUID(), quote: cartQuote(items, 0, shipping), name: "Test", email: "t@example.invalid", phone: "0555 123 45 67", address: "Test address, Istanbul", note: "" });
      assert.ok(result.id, String(result.error)); return result.id;
    };

    assert.deepEqual(orderTotals(await cartFor(owner), 0, { fee: 15000, threshold: 150000 }), { subtotal: 0, shipping: 0, total: 0, freeShippingRemaining: 150000 });
    process.env.TAMI_CHECKOUT_ENABLED = "false";
    assert.equal(await setCartQuantity(owner, product, 1), true);
    assert.equal((await submitOrder(owner, { requestKey: randomUUID(), quote: "x", name: "T", email: "t@example.invalid", phone: "5551234567", address: "x", note: "" })).error, "payment");
    process.env.TAMI_CHECKOUT_ENABLED = "true";

    // Order is created unpaid with shipping, reserves store stock and keeps the cart.
    const first = await place(2);
    let row = await order(first);
    assert.equal(row.status, "awaiting_payment"); assert.equal(row.payment_status, "awaiting");
    assert.equal(Number(row.subtotal_kurus), 20000); assert.equal(Number(row.shipping_kurus), 15000); assert.equal(Number(row.total_kurus), 35000);
    assert.equal(await stock(), 3); assert.equal((await cartFor(owner)).length, 1);

    // Hosted page: one token, reused while fresh; callback URLs are signed per order.
    const started = await payments.startPayment(first);
    assert.ok("url" in started && started.url.startsWith("https://sandbox-portal.tami.com.tr/hostedPaymentPage?token=token-1"));
    const again = await payments.startPayment(first);
    assert.ok("url" in again && again.url === started.url); assert.equal(tokens, 1);
    const attempt = (await db.query("SELECT * FROM commerce_payments WHERE order_id=$1", [first])).rows[0];
    assert.equal(attempt.provider_order_id, `GB2-${row.number}-1`); assert.equal(Number(attempt.amount_kurus), 35000); assert.equal(attempt.status, "pending");
    const signed = new URL(payments.callbackUrl(first));
    assert.equal(payments.validCallback(first, signed.searchParams.get("sig")!), true);
    assert.equal(payments.validCallback(first, "forged"), false);
    assert.equal(payments.validCallback(randomUUID(), signed.searchParams.get("sig")!), false);

    // No transaction yet; a wrong amount is not a payment either.
    await payments.reconcileOrderPayments(first);
    assert.equal((await order(first)).payment_status, "awaiting");
    paid.set(attempt.provider_order_id, 350.01);
    await payments.reconcileOrderPayments(first);
    assert.equal((await order(first)).payment_status, "awaiting");

    // Verified payment marks the order paid and removes only purchased lines from the cart.
    paid.set(attempt.provider_order_id, 350);
    await Promise.all([payments.reconcileOrderPayments(first), payments.reconcileOrderPayments(first)]);
    row = await order(first);
    assert.equal(row.status, "pending"); assert.equal(row.payment_status, "paid"); assert.ok(row.paid_at); assert.equal(row.payment_note, "");
    const succeeded = (await db.query("SELECT * FROM commerce_payments WHERE order_id=$1", [first])).rows[0];
    assert.equal(succeeded.status, "succeeded"); assert.equal(succeeded.bank_reference, `REF-${attempt.provider_order_id}`);
    assert.equal((await cartFor(owner)).length, 0); assert.equal(await stock(), 3);
    assert.deepEqual(await payments.startPayment(first), { error: "paid" });

    // A second capture for the same order is flagged for refund, never silently dropped.
    await db.query("INSERT INTO commerce_payments(order_id,provider_order_id,amount_kurus,status) VALUES($1,$2,35000,'pending')", [first, `GB2-${row.number}-2`]);
    paid.set(`GB2-${row.number}-2`, 350);
    await payments.reconcileOrderPayments(first);
    assert.match((await order(first)).payment_note, /Mükerrer ödeme/);

    // Unanswered or forged provider replies never expire an order.
    const second = await place(1);
    assert.ok("url" in await payments.startPayment(second));
    await db.query("UPDATE commerce_orders SET payment_due_at=now()-interval '1 minute' WHERE id=$1", [second]);
    queryDown = true; await payments.reconcileOrderPayments(second); queryDown = false;
    assert.equal((await order(second)).status, "awaiting_payment");
    forgeMissing = true; await payments.reconcileOrderPayments(second); forgeMissing = false;
    assert.equal((await order(second)).status, "awaiting_payment");
    assert.equal(await stock(), 2);

    // Signed "not found" after the window: cancel and release store stock; no new attempt is opened.
    assert.deepEqual(await payments.startPayment(second), { error: "expired" });
    assert.equal(tokens, 2);
    row = await order(second);
    assert.equal(row.status, "cancelled"); assert.equal(row.payment_status, "expired"); assert.equal(await stock(), 3);

    // Late payment revives the order and takes the stock back.
    const late = (await db.query("SELECT provider_order_id FROM commerce_payments WHERE order_id=$1", [second])).rows[0].provider_order_id;
    paid.set(late, 250);
    assert.deepEqual(await payments.reconcilePendingPayments(), { checked: 1, failed: 0 });
    row = await order(second);
    assert.equal(row.status, "pending"); assert.equal(row.payment_status, "paid"); assert.match(row.payment_note, /süre dolduktan sonra/);
    assert.equal(await stock(), 2);

    // A declined 3D attempt reads as AUTH/NOT_COMPLETED: never paid, and its spent token is not reused on retry.
    const retry = await place(1);
    const firstPage = await payments.startPayment(retry);
    const firstAttempt = (await db.query("SELECT provider_order_id FROM commerce_payments WHERE order_id=$1", [retry])).rows[0].provider_order_id;
    incomplete.add(firstAttempt);
    const secondPage = await payments.startPayment(retry);
    assert.ok("url" in firstPage && "url" in secondPage && firstPage.url !== secondPage.url);
    assert.equal((await order(retry)).payment_status, "awaiting");
    assert.equal((await db.query("SELECT count(*) FROM commerce_payments WHERE order_id=$1", [retry])).rows[0].count, "2");
    await db.query("UPDATE commerce_orders SET status='cancelled',payment_status='expired' WHERE id=$1", [retry]);
    await db.query("UPDATE commerce_payments SET status='abandoned' WHERE order_id=$1", [retry]);
    await db.query("UPDATE products SET stock=stock+1 WHERE id=$1", [product]);

    // Abandoned orders without any attempt also expire through the sweep.
    const third = await place(1);
    await db.query("UPDATE commerce_orders SET payment_due_at=now()-interval '1 minute' WHERE id=$1", [third]);
    await payments.reconcilePendingPayments();
    assert.equal((await order(third)).payment_status, "expired"); assert.equal(await stock(), 2);

    assert.equal(payments.tamiPhone("+90 (555) 123 45 67"), "905551234567");
    assert.equal(payments.tamiPhone("05551234567"), "905551234567");
    assert.equal(payments.tamiPhone("5551234567"), "905551234567");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await db.end(); await control.query(`DROP SCHEMA ${namespace} CASCADE`); control.release(); await root.end();
  }
});
