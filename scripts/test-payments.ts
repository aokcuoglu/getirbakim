import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

// Every TAMI response below is mocked and signed with a synthetic key; no provider request is made.
test("prepaid checkout: hosted attempts, signed reconciliation, expiry, late and duplicate payments", async t => {
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
  const { money } = await import("../src/modules/store/money");
  const originalFetch = globalThis.fetch;
  const paid = new Map<string, number>(); // provider orderId -> amount in TL
  const incomplete = new Set<string>(); // sandbox-observed shape of a declined/abandoned 3D attempt
  const installments = new Map<string, number>(); // provider orderId -> installment count picked on the hosted page
  let tokens = 0, queryDown = false, forgeMissing = false;
  // Slow-provider simulation (#711): every /payment/query waits delayMs and honours the caller's abort signal.
  let delayMs = 0;
  const queries = new Map<string, number>(); // provider orderId -> /payment/query calls
  const slow = (signal: AbortSignal | null | undefined) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input), body = JSON.parse(String(init?.body ?? "{}"));
    if (url.endsWith("/hosted/create-one-time-hosted-token")) {
      tokens++;
      assert.match(body.mobilePhoneNumber, /^90\d{10}$/);
      assert.equal(body.successCallbackUrl, payments.callbackUrl(String(body.successCallbackUrl.match(/order=([^&]+)/)[1])));
      return Response.json({ oneTimeToken: `token-${tokens}`, tokenCreateTime: "2026-10-09T12:00:00" });
    }
    if (url.endsWith("/payment/query")) queries.set(body.orderId, (queries.get(body.orderId) ?? 0) + 1);
    if (delayMs) await slow(init?.signal);
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
    const payload = { success: true, orderId: body.orderId, currency: "TRY", amount, orderStatus: "AUTH", installmentCount: installments.get(body.orderId) ?? 1,
      transactions: [{ transactionType: "AUTH", transactionStatus: "SUCCESS", bankReferenceNumber: `REF-${body.orderId}`, bankAuthCode: "123456" }] };
    return Response.json({ ...payload, securityHash: buildSecurityHash(payload) });
  };
  try {
    await db.query(await readFile("db/schema.sql", "utf8"));
    const commerceSql = await readFile("db/commerce.sql", "utf8");
    await db.query(commerceSql); await db.query(commerceSql);
    await db.query("UPDATE commerce_settings SET shipping_fee_kurus=15000,free_shipping_threshold_kurus=150000");
    const product = (await db.query<{ id: string }>("INSERT INTO store_products(supplier,code,name,brand,price_kurus,stock) VALUES('demo','PAY-1','Payment part','TEST',10000,5) RETURNING id")).rows[0].id;
    const stock = async () => (await db.query<{ stock: number }>("SELECT stock FROM store_products WHERE id=$1", [product])).rows[0].stock;
    const order = async (id: string) => (await db.query("SELECT * FROM commerce_orders WHERE id=$1", [id])).rows[0];
    const reserved = async (id: string) => (await db.query<{ reserved_quantity: number }>("SELECT reserved_quantity FROM commerce_order_items WHERE order_id=$1", [id])).rows[0].reserved_quantity;

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
    assert.equal(await reserved(first), 2);

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
    assert.equal(await reserved(second), 0);
    assert.equal(row.cancelled_by, "expiry"); assert.ok(row.cancelled_at instanceof Date);

    // Late payment revives the order and takes the stock back.
    const late = (await db.query("SELECT provider_order_id FROM commerce_payments WHERE order_id=$1", [second])).rows[0].provider_order_id;
    paid.set(late, 250);
    assert.deepEqual(await payments.reconcilePendingPayments(), { checked: 1, failed: 0 });
    row = await order(second);
    assert.equal(row.status, "pending"); assert.equal(row.payment_status, "paid"); assert.match(row.payment_note, /süre dolduktan sonra/);
    assert.equal(await stock(), 2);
    // A revived order is no longer cancelled by anyone (#607).
    assert.equal(row.cancelled_by, null); assert.equal(row.cancelled_at, null);
    assert.equal(await reserved(second), 1);

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
    await db.query("UPDATE store_products SET stock=stock+1 WHERE id=$1", [product]);

    // Abandoned orders without any attempt also expire through the sweep.
    const third = await place(1);
    await db.query("UPDATE commerce_orders SET payment_due_at=now()-interval '1 minute' WHERE id=$1", [third]);
    await payments.reconcilePendingPayments();
    assert.equal((await order(third)).payment_status, "expired"); assert.equal(await stock(), 2);

    // Late payment with the stock gone: nothing is reserved, so an operations cancel cannot inflate stock (#516).
    const short = await place(1);
    await db.query("UPDATE commerce_orders SET payment_due_at=now()-interval '1 minute' WHERE id=$1", [short]);
    await payments.reconcileOrderPayments(short);
    assert.equal((await order(short)).payment_status, "expired"); assert.equal(await stock(), 2);
    await db.query("UPDATE store_products SET stock=0 WHERE id=$1", [product]);
    await db.query("INSERT INTO commerce_payments(order_id,provider_order_id,amount_kurus,status) VALUES($1,$2,25000,'pending')", [short, `GB2-short-${short}`]);
    paid.set(`GB2-short-${short}`, 250);
    await payments.reconcileOrderPayments(short);
    row = await order(short);
    assert.equal(row.status, "pending"); assert.equal(row.payment_status, "paid"); assert.match(row.payment_note, /mağaza stoku yetersiz/);
    assert.equal(await reserved(short), 0); assert.equal(await stock(), 0);
    const { transitionOrder } = await import("../src/modules/admin/orders");
    assert.equal(await transitionOrder(short, "cancelled"), true);
    assert.equal(await stock(), 0); assert.equal((await order(short)).payment_status, "refund_required");

    // #711: throttled callers claim attempts atomically, skipped attempts block expiry, interactive paths are budgeted.
    await db.query("UPDATE store_products SET stock=20 WHERE id=$1", [product]);
    const addAttempt = async (orderId: string, n: number, checkedAt: string | null = null) => {
      const providerId = `GB2-711-${orderId}-${n}`;
      await db.query(`INSERT INTO commerce_payments(order_id,provider_order_id,amount_kurus,status,created_at,checked_at)
        VALUES($1,$2,(SELECT total_kurus FROM commerce_orders WHERE id=$1),'pending',now()+make_interval(secs=>$3),$4)`, [orderId, providerId, n, checkedAt]);
      return providerId;
    };
    const queried = (ids: string[]) => ids.map(id => queries.get(id) ?? 0);
    const timed = async <T>(work: () => Promise<T>) => { const started = performance.now(); const value = await work(); return { value, ms: performance.now() - started }; };

    // Two concurrent throttled checks ask TAMI once per attempt; unthrottled callers (interval 0) always ask.
    const guarded = await place(1);
    const guardIds = [await addAttempt(guarded, 1), await addAttempt(guarded, 2)];
    delayMs = 100;
    await Promise.all([payments.reconcileOrderPayments(guarded, { minIntervalSeconds: 5 }), payments.reconcileOrderPayments(guarded, { minIntervalSeconds: 5 })]);
    assert.deepEqual(queried(guardIds), [1, 1]);
    await Promise.all([payments.reconcileOrderPayments(guarded), payments.reconcileOrderPayments(guarded)]);
    assert.deepEqual(queried(guardIds), [3, 3]);
    delayMs = 0;
    assert.equal((await order(guarded)).status, "awaiting_payment");

    // A throttled call that skipped an open attempt never expires the order; an unthrottled one with a signed answer does.
    const skippedOrder = await place(2);
    await addAttempt(skippedOrder, 1, new Date().toISOString());
    await db.query("UPDATE commerce_orders SET payment_due_at=now()-interval '1 minute' WHERE id=$1", [skippedOrder]);
    const stockBefore = await stock();
    assert.deepEqual(await payments.reconcileOrderPayments(skippedOrder, { minIntervalSeconds: 5 }), { uncertain: false });
    assert.equal((await order(skippedOrder)).status, "awaiting_payment"); assert.equal(await stock(), stockBefore);
    await payments.reconcileOrderPayments(skippedOrder);
    row = await order(skippedOrder);
    assert.equal(row.status, "cancelled"); assert.equal(row.payment_status, "expired"); assert.equal(await stock(), stockBefore + 2);

    // A slow TAMI answer on an interactive path ends at the budget as uncertain; the order is left alone.
    const budgeted = await place(1);
    await addAttempt(budgeted, 1);
    await db.query("UPDATE commerce_orders SET payment_due_at=now()-interval '1 minute' WHERE id=$1", [budgeted]);
    delayMs = 2000;
    const capped = await timed(() => payments.reconcileOrderPayments(budgeted, { minIntervalSeconds: 5, deadlineMs: 200 }));
    delayMs = 0;
    t.diagnostic(`TAMI answering after 2000 ms, budget 200 ms: returned in ${Math.round(capped.ms)} ms`);
    assert.ok(capped.ms < 1000, `budgeted reconcile took ${Math.round(capped.ms)} ms`);
    assert.deepEqual(capped.value, { uncertain: true });
    row = await order(budgeted);
    assert.equal(row.status, "awaiting_payment"); assert.equal(row.payment_status, "awaiting");
    await db.query("UPDATE commerce_orders SET payment_due_at=now()+interval '45 minutes' WHERE id=$1", [budgeted]);

    // Before/after: three open attempts, 150 ms per TAMI answer; serial (callback/sweep) vs. one budgeted round.
    const many = await place(1);
    const manyIds = [await addAttempt(many, 1), await addAttempt(many, 2), await addAttempt(many, 3)];
    for (const id of manyIds) incomplete.add(id);
    delayMs = 150;
    const serial = await timed(() => payments.reconcileOrderPayments(many));
    await db.query("UPDATE commerce_payments SET provider_result=NULL WHERE order_id=$1", [many]);
    const parallel = await timed(() => payments.reconcileOrderPayments(many, { deadlineMs: 1000 }));
    delayMs = 0;
    t.diagnostic(`3 open attempts at 150 ms each: serial ${Math.round(serial.ms)} ms, budgeted ${Math.round(parallel.ms)} ms`);
    assert.ok(serial.ms >= 450, `serial reconcile took ${Math.round(serial.ms)} ms`);
    assert.ok(parallel.ms < 350, `budgeted reconcile took ${Math.round(parallel.ms)} ms`);
    assert.deepEqual(parallel.value, { uncertain: false });
    assert.deepEqual(queried(manyIds), [2, 2, 2]);
    assert.equal((await db.query("SELECT count(*) FROM commerce_payments WHERE order_id=$1 AND provider_result IS NOT NULL", [many])).rows[0].count, "3");

    // Payments found on the budgeted path are applied in attempt order: paid first, then the duplicate note.
    const doubled = await place(1);
    const doubledTotal = Number((await order(doubled)).total_kurus) / 100;
    const doubledIds = [await addAttempt(doubled, 1), await addAttempt(doubled, 2)];
    for (const id of doubledIds) paid.set(id, doubledTotal);
    delayMs = 50;
    await payments.reconcileOrderPayments(doubled, { minIntervalSeconds: 5, deadlineMs: 1000 });
    delayMs = 0;
    row = await order(doubled);
    assert.equal(row.status, "pending"); assert.equal(row.payment_status, "paid");
    assert.match(row.payment_note, new RegExp(`Mükerrer ödeme alındı \\(${doubledIds[1]}\\)`));
    assert.doesNotMatch(row.payment_note, new RegExp(doubledIds[0]));
    assert.equal((await db.query("SELECT count(*) FROM commerce_payments WHERE order_id=$1 AND status='succeeded'", [doubled])).rows[0].count, "2");

    // #873: an installment payment picked on the hosted page still settles the order but is flagged for the merchant's commission.
    const split = await place(1);
    const splitId = await addAttempt(split, 1);
    paid.set(splitId, Number((await order(split)).total_kurus) / 100); installments.set(splitId, 6);
    await payments.reconcileOrderPayments(split);
    row = await order(split);
    assert.equal(row.status, "pending"); assert.equal(row.payment_status, "paid");
    assert.match(row.payment_note, new RegExp(`TAMI'de 6 taksitle ödendi \\(${splitId}\\)`));
    assert.equal((await db.query("SELECT installment_count FROM commerce_payments WHERE provider_order_id=$1", [splitId])).rows[0].installment_count, 6);

    // #886: installments off leave the quote as before; on, the chosen option is recomputed and charged with its fee.
    const { installmentSettings } = await import("../src/modules/payments/installment-settings");
    const { installmentTotal } = await import("../src/modules/payments/installment-plan");
    assert.equal(await setCartQuantity(owner, product, 1), true);
    const quoteItems = await cartFor(owner), quoteShipping = await shippingRule();
    const disabled = await installmentSettings();
    assert.equal(disabled.enabled, false);
    assert.equal(cartQuote(quoteItems, 0, quoteShipping), cartQuote(quoteItems, 0, quoteShipping, disabled));
    await db.query("UPDATE commerce_settings SET installments_enabled=true");
    try {
      const settings = await installmentSettings();
      assert.deepEqual([settings.max, settings.singleRateBp, settings.ratesBp[3], settings.ratesBp[6]], [6, 285, 795, 1347]);
      const checkout = (installmentsChosen: number, quote: string) => submitOrder(owner, { requestKey: randomUUID(), quote, name: "Test", email: "t@example.invalid",
        phone: "0555 123 45 67", address: "Test address, Istanbul", note: "", installments: installmentsChosen });
      const freshQuote = async () => cartQuote(await cartFor(owner), 0, await shippingRule(), await installmentSettings());
      // A form quoted before installments were switched on, or a count the settings do not offer, is refused.
      assert.equal((await checkout(3, cartQuote(await cartFor(owner), 0, await shippingRule()))).error, "price");
      assert.equal((await checkout(9, await freshQuote())).error, "price");
      const placeInstallments = async (count: number) => {
        assert.equal(await setCartQuantity(owner, product, 1), true);
        const result = await checkout(count, await freshQuote());
        assert.ok(result.id, String(result.error)); return result.id;
      };
      const cash = 10000 + 15000, threeTotal = installmentTotal(cash, 285, 795);
      const chosenThree = await placeInstallments(3);
      row = await order(chosenThree);
      assert.equal(row.installment_count, 3); assert.equal(Number(row.installment_fee_kurus), threeTotal - cash); assert.equal(Number(row.total_kurus), threeTotal);
      assert.equal(Number(row.subtotal_kurus), 10000); assert.equal(Number(row.shipping_kurus), 15000);
      assert.ok("url" in await payments.startPayment(chosenThree));
      const threeAttempt = (await db.query("SELECT provider_order_id,amount_kurus FROM commerce_payments WHERE order_id=$1", [chosenThree])).rows[0];
      assert.equal(Number(threeAttempt.amount_kurus), threeTotal);
      // Paid with the chosen count: no note.
      paid.set(threeAttempt.provider_order_id, threeTotal / 100); installments.set(threeAttempt.provider_order_id, 3);
      await payments.reconcileOrderPayments(chosenThree);
      row = await order(chosenThree);
      assert.equal(row.payment_status, "paid"); assert.equal(row.payment_note, "");
      // Fewer installments on the hosted page: the fee goes back to the buyer.
      const fewer = await placeInstallments(3);
      const fewerId = await addAttempt(fewer, 1);
      paid.set(fewerId, threeTotal / 100); installments.set(fewerId, 1);
      await payments.reconcileOrderPayments(fewer);
      row = await order(fewer);
      assert.equal(row.payment_status, "paid");
      assert.match(row.payment_note, /Siparişte 3 taksit seçildi, TAMI'de tek çekim ödendi/);
      assert.match(row.payment_note, /vade farkı iadesi gerekir/);
      assert.ok(row.payment_note.includes(`(≈ ${money(threeTotal - cash)})`), row.payment_note);
      // More installments: the extra commission stays with the merchant.
      const more = await placeInstallments(3);
      const moreId = await addAttempt(more, 1);
      paid.set(moreId, threeTotal / 100); installments.set(moreId, 6);
      await payments.reconcileOrderPayments(more);
      row = await order(more);
      assert.equal(row.payment_status, "paid");
      assert.match(row.payment_note, new RegExp(`TAMI'de 6 taksitle ödendi \\(${moreId}\\); siparişte 3 taksit seçilmişti`));
      assert.doesNotMatch(row.payment_note, /iadesi/);
      // Fewer but still split (3 chosen, 2 paid): the refund is the difference to the 2-installment total at current rates.
      const twoPaid = await placeInstallments(3);
      const twoPaidId = await addAttempt(twoPaid, 1);
      paid.set(twoPaidId, threeTotal / 100); installments.set(twoPaidId, 2);
      await payments.reconcileOrderPayments(twoPaid);
      row = await order(twoPaid);
      assert.equal(row.payment_status, "paid");
      assert.match(row.payment_note, /Siparişte 3 taksit seçildi, TAMI'de 2 taksitle ödendi/);
      assert.ok(row.payment_note.includes(`vade farkı iadesi gerekir (≈ ${money(threeTotal - installmentTotal(cash, 285, 589))})`), row.payment_note);
      // A capture that does not settle the order (a duplicate on a paid order) gets no fee-refund note: the whole capture goes back.
      const duplicateId = `GB2-886-dup-${chosenThree}`;
      await db.query("INSERT INTO commerce_payments(order_id,provider_order_id,amount_kurus,status) VALUES($1,$2,$3,'pending')", [chosenThree, duplicateId, threeTotal]);
      paid.set(duplicateId, threeTotal / 100); installments.set(duplicateId, 1);
      await payments.reconcileOrderPayments(chosenThree);
      row = await order(chosenThree);
      assert.match(row.payment_note, /Mükerrer ödeme alındı/);
      assert.doesNotMatch(row.payment_note, /vade farkı iadesi/);
      // A count TAMI did not report as a positive integer adds no note.
      const oddCount = await placeInstallments(3);
      const oddId = await addAttempt(oddCount, 1);
      paid.set(oddId, threeTotal / 100); installments.set(oddId, 0);
      await payments.reconcileOrderPayments(oddCount);
      row = await order(oddCount);
      assert.equal(row.payment_status, "paid"); assert.equal(row.payment_note, "");
    } finally {
      await db.query("UPDATE commerce_settings SET installments_enabled=false");
    }

    assert.equal(payments.tamiPhone("+90 (555) 123 45 67"), "905551234567");
    assert.equal(payments.tamiPhone("05551234567"), "905551234567");
    assert.equal(payments.tamiPhone("5551234567"), "905551234567");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await db.end(); await control.query(`DROP SCHEMA ${namespace} CASCADE`); control.release(); await root.end();
  }
});
