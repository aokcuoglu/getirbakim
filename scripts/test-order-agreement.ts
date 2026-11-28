import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mock, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { checkoutConsentText, checkoutInput } from "../src/modules/store/checkout-schema";
import { buildOrderAgreement, defaultSources, legalTextVersion, type AgreementSources } from "../src/modules/store/order-agreement";
import { clientEvidence } from "../src/lib/client-address";

// Checkout consent evidence and the order-specific pre-contract copy (#604).
const fields = { requestKey: randomUUID(), quote: "a".repeat(64), name: "Ayşe Yılmaz", email: "ayse@example.invalid", phone: "0555 123 45 67",
  province: "İstanbul", district: "Kadıköy", addressLine: "Test Mahallesi 1. Sokak No 2", postalCode: "34710", note: "", invoiceType: "individual" };
// What the checkout action hands to submitOrder (#881).
const form = checkoutInput.parse({ ...fields, consent: "on" });

test("no order input without the pre-contract consent", () => {
  assert.equal(checkoutInput.safeParse(fields).success, false);
  assert.equal(checkoutInput.safeParse({ ...fields, consent: "off" }).success, false);
  assert.equal(checkoutInput.safeParse({ ...fields, consent: "on" }).success, true);
  assert.equal(form.address, "Test Mahallesi 1. Sokak No 2, 34710 Kadıköy/İstanbul");
});

test("the stored consent text is the checkbox label shown at checkout", async () => {
  const page = await readFile("src/app/(store)/siparis-olustur/page.tsx", "utf8");
  const label = page.match(/<FieldLabel htmlFor="checkout-consent"[^>]*>([\s\S]*?)<\/FieldLabel>/)?.[1];
  assert.ok(label, "consent label not found");
  assert.equal(label.replace(/<\/?Link[^>]*>/g, ""), checkoutConsentText);
});

const order = { number: "42", createdAt: new Date("2026-11-15T09:30:00Z"), name: "Ayşe Yılmaz", email: "ayse@example.invalid", phone: "0555 123 45 67",
  address: "Test Mahallesi 1. Sokak No 2, Kadıköy İstanbul", note: "Kapıya bırakın", discountPercent: 10,
  subtotalKurus: 27000, shippingKurus: 15000, totalKurus: 42000 };
const lines = [{ name: "Yağ filtresi", brand: "MANN", code: "W 712/95", quantity: 2, unitPriceKurus: 9000 },
  { name: "Hava filtresi", brand: "", code: "C 2029", quantity: 1, unitPriceKurus: 9000 }];
const text = (value: unknown) => JSON.stringify(value);

test("the agreement fills both documents with the buyer, lines, totals and seller", () => {
  const agreement = buildOrderAgreement(order, lines);
  assert.equal(agreement.schema, 1);
  assert.deepEqual(agreement.documents.map(d => d.slug), ["on-bilgilendirme-formu", "mesafeli-satis-sozlesmesi"]);
  for (const document of agreement.documents) {
    const body = text(document);
    assert.equal(document.sections[0].title, "Satıcı Bilgileri");
    assert.match(body, /ERGUL ENERJI SAN TIC LTD STI/);
    for (const value of [order.name, order.email, order.phone, order.address, order.note, "#42", "%10", "15.11.2026 12:30:00"]) assert.ok(body.includes(value), value);
    assert.ok(body.includes("2 × Yağ filtresi (MANN W 712/95) — birim fiyat ₺90,00 — tutar ₺180,00"));
    assert.ok(body.includes("1 × Hava filtresi (C 2029) — birim fiyat ₺90,00 — tutar ₺90,00"));
    for (const value of ["₺270,00", "₺150,00", "₺420,00", "TAMI"]) assert.ok(body.includes(value), value);
    const titles = document.sections.map(s => s.title);
    assert.ok(!titles.includes("Kapsam ve Bilgilendirme") && !titles.includes("Siparişe Özgü Bilgiler"));
    assert.ok(titles.includes("Cayma Hakkı ve Bildirim"));
  }
  const free = text(buildOrderAgreement({ ...order, shippingKurus: 0, discountPercent: 0 }, lines));
  assert.match(free, /Ücretsiz/); assert.doesNotMatch(free, /Servis indirimi/);
});

test("a corporate invoice names the title, tax number and office in the buyer section; an individual one does not (#881)", () => {
  const invoice = { company: "Yılmaz Otomotiv Ltd. Şti.", taxNo: "1234567890", taxOffice: "Kadıköy" };
  for (const document of buildOrderAgreement({ ...order, invoice }, lines).documents) {
    const buyer = text(document.sections.find(section => section.title === "Alıcı Bilgileri"));
    for (const value of ["Fatura unvanı: ", invoice.company, "Vergi/TC kimlik no: ", invoice.taxNo, "Vergi dairesi: ", invoice.taxOffice]) assert.ok(buyer.includes(value), value);
  }
  for (const individual of [buildOrderAgreement(order, lines), buildOrderAgreement({ ...order, invoice: null }, lines)]) {
    for (const document of individual.documents)
      assert.doesNotMatch(text(document.sections.find(section => section.title === "Alıcı Bilgileri")), /Fatura unvanı|kimlik no|Vergi dairesi/);
  }
});

test("the buyer section always names the invoice address: the delivery address unless a separate one is given (#916)", () => {
  const separate = "Atatürk Bulvarı No 1, 06690 Çankaya/Ankara";
  for (const same of [buildOrderAgreement(order, lines), buildOrderAgreement({ ...order, invoiceAddress: null }, lines)])
    for (const document of same.documents)
      assert.ok(text(document.sections.find(section => section.title === "Alıcı Bilgileri")).includes(`"Fatura adresi: "]},${JSON.stringify(order.address)}`));
  for (const document of buildOrderAgreement({ ...order, invoiceAddress: separate }, lines).documents) {
    const buyer = text(document.sections.find(section => section.title === "Alıcı Bilgileri"));
    assert.ok(buyer.includes(`"Fatura adresi: "]},${JSON.stringify(separate)}`));
    assert.ok(buyer.includes(`"Teslimat adresi: "]},${JSON.stringify(order.address)}`));
  }
});

test("an installment order names the fee and the count; a single payment does not (#886)", () => {
  const single = text(buildOrderAgreement(order, lines));
  assert.doesNotMatch(single, /Vade farkı/); assert.match(single, /peşin ödeme/);
  const split = text(buildOrderAgreement({ ...order, totalKurus: 44330, installmentCount: 3, installmentFeeKurus: 2330 }, lines));
  assert.ok(split.includes("Vade farkı (3 taksit): "), "fee label");
  for (const value of ["₺23,30", "₺443,30", "3 taksitle ödeme"]) assert.ok(split.includes(value), value);
  assert.doesNotMatch(split, /peşin ödeme/);
});

test("a no-fee installment order shows no fee row and says vade farksız (#1462)", () => {
  const noFee = text(buildOrderAgreement({ ...order, installmentCount: 3, installmentFeeKurus: 0 }, lines));
  assert.doesNotMatch(noFee, /Vade farkı/);
  assert.ok(noFee.includes("3 taksitle ödeme (vade farksız)"), "no-fee payment line");
});

function editedSources(): AgreementSources {
  const sources = structuredClone(defaultSources());
  const section = sources["mesafeli-satis-sozlesmesi"].sections.at(-1)!;
  section.blocks = [...section.blocks, "x"];
  return sources;
}

test("the text version follows the legal pages", () => {
  assert.equal(legalTextVersion(), legalTextVersion(defaultSources()));
  assert.match(legalTextVersion(), /^\d{4}-\d{2}-\d{2}\.[0-9a-f]{12}$/);
  assert.notEqual(legalTextVersion(editedSources()), legalTextVersion());
});

test("client evidence prefers the CDN viewer address and drops invalid values", () => {
  const evidence = (headers: Record<string, string>) => clientEvidence(new Headers(headers));
  assert.deepEqual(evidence({ "cloudfront-viewer-address": "203.0.113.7:51234", "x-real-ip": "10.0.0.1", "x-forwarded-for": "1.1.1.1, 10.0.0.2", "user-agent": "Test UA" }),
    { ip: "203.0.113.7", forwardedFor: "1.1.1.1, 10.0.0.2", userAgent: "Test UA" });
  assert.equal(evidence({ "cloudfront-viewer-address": "[2001:db8::1]:443" }).ip, "2001:db8::1");
  // CloudFront's documented IPv6 form is the full eight groups plus the port.
  assert.equal(evidence({ "cloudfront-viewer-address": "2001:0db8:85a3:0000:0000:8a2e:0370:7334:46532" }).ip, "2001:0db8:85a3:0000:0000:8a2e:0370:7334");
  assert.equal(evidence({ "cloudfront-viewer-address": "2001:db8::1" }).ip, "2001:db8::1");
  assert.equal(evidence({ "cloudfront-viewer-address": "garbage", "x-forwarded-for": "198.51.100.4" }).ip, "198.51.100.4");
  assert.equal(evidence({ "x-real-ip": "198.51.100.5" }).ip, null);
  assert.equal(evidence({ "x-real-ip": "198.51.100.5", "x-forwarded-for": "192.0.2.10" }).ip, "192.0.2.10");
  assert.equal(evidence({ "x-forwarded-for": "spoofed, 192.0.2.9" }).ip, "192.0.2.9");
  assert.equal(evidence({ "x-forwarded-for": "also-bad" }).ip, null);
  assert.deepEqual(evidence({}), { ip: null, forwardedFor: null, userAgent: null });
  assert.equal(evidence({ "user-agent": "u".repeat(900) }).userAgent?.length, 500);
  const chain = evidence({ "x-forwarded-for": `${"1.1.1.1,".repeat(100)} 192.0.2.77` }).forwardedFor;
  assert.equal(chain?.length, 500); assert.ok(chain?.endsWith("192.0.2.77"));
});

test("placing an order stores the consent and an immutable order-specific copy", async () => {
  const env: Record<string, string> = {
    TAMI_CHECKOUT_ENABLED: "true", SITE_URL: "https://shop.example.invalid", TAMI_MERCHANT_NUMBER: "test-merchant", TAMI_TERMINAL_NUMBER: "test-terminal",
    TAMI_SECRET_KEY: "synthetic-test-secret", TAMI_JWK_KID: "test-kid", TAMI_JWK_K: Buffer.from("synthetic-test-hmac-key").toString("base64url"),
    TAMI_PAYMENT_API_BASE_URL: "https://sandbox-paymentapi.tami.com.tr", TAMI_PORTAL_BASE_URL: "https://sandbox-portal.tami.com.tr",
  };
  const originalEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const schema = await isolatedSchema("order_agreement_test");
  const { db } = await import("../src/lib/db");
  try {
    const { submitOrder, cartQuote, shippingRule, unsellableLines } = await import("../src/modules/store/orders");
    // Lines the order cannot sell are listed by id (#1188).
    const line = (id: string, over: Record<string, unknown> = {}) => ({ id, available: true, price_kurus: 1000, quantity: 1, max_quantity: 5, ...over }) as never;
    assert.deepEqual(unsellableLines([line("ok"), line("nopr", { price_kurus: null }), line("off", { available: false }), line("cap", { quantity: 6 })], 0), ["nopr", "off", "cap"]);
    assert.deepEqual(unsellableLines([line("cheap", { price_kurus: 1 })], 100), ["cheap"]);
    assert.deepEqual(unsellableLines([line("cheap", { price_kurus: 1 })], 0), []);
    assert.deepEqual(unsellableLines([line("ok")], 0), []);

    const { cartFor, setCartQuantity } = await import("../src/modules/store/cart");
    await schema.pool.query("UPDATE commerce_settings SET shipping_fee_kurus=15000,free_shipping_threshold_kurus=150000");
    const product = (await schema.pool.query<{ id: string }>(`INSERT INTO store_products(supplier,code,name,brand,price_kurus,stock)
      VALUES('demo','AGR-1','BRAKE DISC','TEST',10000,20) RETURNING id::text`)).rows[0].id;
    const owner = { kind: "guest" as const, id: randomBytes(32).toString("hex") };
    await schema.pool.query("INSERT INTO guest_carts(token_hash) VALUES($1)", [owner.id]);
    assert.equal(await setCartQuantity(owner, product, 2), true);
    const input = async () => ({ ...form, requestKey: randomUUID(), quote: cartQuote(await cartFor(owner), 0, await shippingRule()) });
    const evidence = { ip: "203.0.113.7", forwardedFor: "203.0.113.7, 10.0.0.2", userAgent: "Mozilla/5.0 Test" };
    const agreementRow = async (id: string) => (await schema.pool.query("SELECT * FROM commerce_order_agreements WHERE order_id=$1", [id])).rows;

    const first = await input();
    const placed = await submitOrder(owner, first, null, evidence);
    assert.ok(placed.id, String(placed.error));
    const [row] = await agreementRow(placed.id);
    assert.equal(row.ip, evidence.ip); assert.equal(row.forwarded_for, evidence.forwardedFor); assert.equal(row.user_agent, evidence.userAgent);
    assert.equal(row.consent_text, checkoutConsentText); assert.equal(row.legal_version, legalTextVersion());
    const orderRow = (await schema.pool.query("SELECT * FROM commerce_orders WHERE id=$1", [placed.id])).rows[0];
    assert.equal(row.accepted_at.getTime(), orderRow.created_at.getTime());
    assert.deepEqual(row.document, buildOrderAgreement({ number: orderRow.number, createdAt: orderRow.created_at, name: form.name, email: form.email,
      phone: form.phone, address: form.address, note: form.note, invoice: null, invoiceAddress: null, discountPercent: 0, subtotalKurus: 20000, shippingKurus: 15000, totalKurus: 35000 },
    [{ name: "Fren Diski", brand: "TEST", code: "AGR-1", quantity: 2, unitPriceKurus: 10000 }]));
    // #952: the copy and the order line name the part as the cart showed it, never the raw English supplier name.
    assert.ok(!JSON.stringify(row.document).includes("BRAKE DISC"));
    assert.deepEqual((await schema.pool.query("SELECT name,code FROM commerce_order_items WHERE order_id=$1", [placed.id])).rows, [{ name: "Fren Diski", code: "AGR-1" }]);

    assert.equal(orderRow.address, "Test Mahallesi 1. Sokak No 2, 34710 Kadıköy/İstanbul");
    assert.deepEqual([orderRow.delivery_province, orderRow.delivery_district, orderRow.delivery_address_line, orderRow.delivery_postal_code, orderRow.invoice_type, orderRow.invoice_company],
      ["İstanbul", "Kadıköy", "Test Mahallesi 1. Sokak No 2", "34710", "individual", null]);
    assert.deepEqual([orderRow.invoice_province, orderRow.invoice_district, orderRow.invoice_address_line, orderRow.invoice_postal_code], [null, null, null, null]);

    // A corporate order stores its invoice details and names them in its copy.
    const corporate = checkoutInput.parse({ ...fields, consent: "on", requestKey: randomUUID(), quote: cartQuote(await cartFor(owner), 0, await shippingRule()),
      invoiceType: "corporate", invoiceCompany: "Yılmaz Otomotiv Ltd. Şti.", invoiceTaxNo: "10000000146", invoiceTaxOffice: "Kadıköy" });
    const corporateOrder = await submitOrder(owner, corporate, null, evidence);
    assert.ok(corporateOrder.id, String(corporateOrder.error));
    const corporateRow = (await schema.pool.query("SELECT invoice_type,invoice_company,invoice_tax_no,invoice_tax_office FROM commerce_orders WHERE id=$1", [corporateOrder.id])).rows[0];
    assert.deepEqual(corporateRow, { invoice_type: "corporate", invoice_company: "Yılmaz Otomotiv Ltd. Şti.", invoice_tax_no: "10000000146", invoice_tax_office: "Kadıköy" });
    assert.match(JSON.stringify((await agreementRow(corporateOrder.id))[0].document), /Vergi\/TC kimlik no: "\]\},"10000000146"/);

    // A retried submit returns the same order and writes nothing new.
    assert.deepEqual(await submitOrder(owner, first, null, { ip: "198.51.100.1", forwardedFor: null, userAgent: "other" }), { id: placed.id });
    assert.equal((await agreementRow(placed.id)).length, 1);
    assert.equal((await schema.pool.query("SELECT count(*)::int AS n FROM commerce_order_agreements")).rows[0].n, 2);

    // The copy cannot be changed, and later legal page edits do not touch it.
    await assert.rejects(schema.pool.query("UPDATE commerce_order_agreements SET legal_version='x' WHERE order_id=$1", [placed.id]), /immutable/);
    assert.notEqual(legalTextVersion(editedSources()), row.legal_version);
    const [after] = await agreementRow(placed.id);
    assert.equal(after.legal_version, row.legal_version); assert.deepEqual(after.document, row.document);

    // Callers without request evidence (scripts) still get an order and a record with empty evidence.
    const bare = await submitOrder(owner, await input());
    assert.ok(bare.id, String(bare.error));
    const [bareRow] = await agreementRow(bare.id);
    assert.equal(bareRow.ip, null); assert.equal(bareRow.forwarded_for, null); assert.equal(bareRow.user_agent, null);
    assert.equal(bareRow.consent_text, checkoutConsentText);

    // A separate invoice address (#916), here with a corporate invoice, is stored in its own columns and named in the copy;
    // the delivery address is unchanged.
    const separate = checkoutInput.parse({ ...fields, consent: "on", requestKey: randomUUID(), quote: cartQuote(await cartFor(owner), 0, await shippingRule()),
      invoiceType: "corporate", invoiceCompany: "Yılmaz Otomotiv Ltd. Şti.", invoiceTaxNo: "1234567890", invoiceTaxOffice: "Çankaya", invoiceAddressMode: "separate", invoiceProvince: "Ankara", invoiceDistrict: "Çankaya", invoiceAddressLine: "Atatürk Bulvarı No 1", invoicePostalCode: "" });
    const separateOrder = await submitOrder(owner, separate, null, evidence);
    assert.ok(separateOrder.id, String(separateOrder.error));
    const separateRow = (await schema.pool.query(`SELECT address,invoice_type,invoice_tax_no,invoice_province,invoice_district,invoice_address_line,invoice_postal_code FROM commerce_orders WHERE id=$1`, [separateOrder.id])).rows[0];
    assert.deepEqual(separateRow, { address: "Test Mahallesi 1. Sokak No 2, 34710 Kadıköy/İstanbul", invoice_type: "corporate", invoice_tax_no: "1234567890", invoice_province: "Ankara", invoice_district: "Çankaya",
      invoice_address_line: "Atatürk Bulvarı No 1", invoice_postal_code: null });
    const separateDocument = JSON.stringify((await agreementRow(separateOrder.id))[0].document);
    assert.ok(separateDocument.includes(`"Fatura adresi: "]},"Atatürk Bulvarı No 1, Çankaya/Ankara"`));
    assert.ok(separateDocument.includes(`"Teslimat adresi: "]},"Test Mahallesi 1. Sokak No 2, 34710 Kadıköy/İstanbul"`));

    // Each line keeps the vehicle it was added with (else the garage's) and its fitment level at order time (#708).
    const vehicle = { make: "Fiat", model: "Doblo", year: 2015, vehicleId: "999999" };
    const garageVehicle = { make: "Renault", model: "Clio", year: 2018 };
    const second = (await schema.pool.query<{ id: string }>(`INSERT INTO store_products(supplier,code,name,brand,price_kurus,stock)
      VALUES('demo','AGR-2','Second part','TEST',5000,10) RETURNING id::text`)).rows[0].id;
    const lineOwner = { kind: "guest" as const, id: randomBytes(32).toString("hex") };
    await schema.pool.query("INSERT INTO guest_carts(token_hash) VALUES($1)", [lineOwner.id]);
    assert.equal(await setCartQuantity(lineOwner, product, 1, false, vehicle), true);
    assert.equal(await setCartQuantity(lineOwner, second, 1), true);
    const orderLines = async (garage: typeof garageVehicle | null) => {
      const placedLines = await submitOrder(lineOwner, { ...form, requestKey: randomUUID(), quote: cartQuote(await cartFor(lineOwner), 0, await shippingRule()) }, garage);
      assert.ok(placedLines.id, String(placedLines.error));
      return (await schema.pool.query("SELECT code,vehicle,fitment_level FROM commerce_order_items WHERE order_id=$1 ORDER BY code", [placedLines.id])).rows;
    };
    assert.deepEqual(await orderLines(null), [{ code: "AGR-1", vehicle, fitment_level: "unknown" }, { code: "AGR-2", vehicle: null, fitment_level: "no_vehicle" }]);
    assert.deepEqual(await orderLines(garageVehicle), [{ code: "AGR-1", vehicle, fitment_level: "unknown" },
      { code: "AGR-2", vehicle: garageVehicle, fitment_level: "unknown" }]);

    // The cart changes after the fitment preload and before BEGIN (#719): the stored level is resolved again inside the
    // transaction. The race is injected by changing the cart right after submitOrder reads the cart for its fitment preload.
    const { productFitmentLevel } = await import("../src/modules/store/fitment-level.server");
    const racing = { kind: "guest" as const, id: randomBytes(32).toString("hex") };
    const final = { kind: "guest" as const, id: randomBytes(32).toString("hex") };
    for (const cartOwner of [racing, final]) await schema.pool.query("INSERT INTO guest_carts(token_hash) VALUES($1)", [cartOwner.id]);
    assert.equal(await setCartQuantity(racing, product, 1), true);
    assert.equal(await setCartQuantity(final, product, 1, false, vehicle), true);
    assert.equal(await setCartQuantity(final, second, 1), true);
    const finalQuote = cartQuote(await cartFor(final), 0, await shippingRule());
    let injected = false;
    const originalQuery = db.query.bind(db) as (...args: unknown[]) => Promise<unknown>;
    const query = mock.method(db, "query", async (...args: unknown[]) => {
      const result = await originalQuery(...args);
      if (typeof args[0] === "string" && args[0].startsWith("SELECT product_id::text,vehicle FROM commerce_cart_items")) {
        // The preload has just read one line without a vehicle: the vehicle is now set on it and a second line has joined.
        injected = true;
        query.mock.restore();
        await schema.pool.query("UPDATE commerce_cart_items SET vehicle=$2 WHERE owner_id=$1 AND product_id=$3", [racing.id, JSON.stringify(vehicle), product]);
        await schema.pool.query(`INSERT INTO commerce_cart_items(owner_kind,owner_id,product_id,quantity) VALUES('guest',$1,$2,1)`, [racing.id, second]);
      }
      return result;
    });
    let raced: Awaited<ReturnType<typeof submitOrder>>;
    try { raced = await submitOrder(racing, { ...form, requestKey: randomUUID(), quote: finalQuote }); }
    finally { query.mock.restore(); }
    assert.equal(injected, true, "fitment preload query text changed — race hook did not fire");
    assert.ok(raced.id, String(raced.error));
    const racedLines = (await schema.pool.query<{ code: string; vehicle: unknown; fitment_level: string }>(
      "SELECT code,vehicle,fitment_level FROM commerce_order_items WHERE order_id=$1 ORDER BY code", [raced.id])).rows;
    const reference = [await productFitmentLevel({ id: product, code: "AGR-1", brand: "TEST" }, vehicle), await productFitmentLevel({ id: second, code: "AGR-2", brand: "TEST" }, null)];
    assert.deepEqual(reference, ["unknown", "no_vehicle"]);
    assert.deepEqual(racedLines, [{ code: "AGR-1", vehicle, fitment_level: reference[0] }, { code: "AGR-2", vehicle: null, fitment_level: reference[1] }]);

    // An order that fails on an unsellable line names it (#1188): the second product sells out after the up-front quote.
    const refusedOwner = { kind: "guest" as const, id: randomBytes(32).toString("hex") };
    await schema.pool.query("INSERT INTO guest_carts(token_hash) VALUES($1)", [refusedOwner.id]);
    assert.equal(await setCartQuantity(refusedOwner, product, 1), true);
    assert.equal(await setCartQuantity(refusedOwner, second, 1), true);
    const refusedQuote = cartQuote(await cartFor(refusedOwner), 0, await shippingRule());
    const orderCount = async () => Number((await schema.pool.query<{ n: string }>("SELECT count(*) AS n FROM commerce_orders")).rows[0].n);
    const ordersBefore = await orderCount();
    const secondStock = (await schema.pool.query<{ stock: number }>("SELECT stock FROM store_products WHERE id=$1", [second])).rows[0].stock;
    let soldOut = false;
    const refusedQuery = mock.method(db, "query", async (...args: unknown[]) => {
      const result = await originalQuery(...args);
      if (typeof args[0] === "string" && args[0].startsWith("SELECT product_id::text,vehicle FROM commerce_cart_items")) {
        soldOut = true;
        refusedQuery.mock.restore();
        await schema.pool.query("UPDATE store_products SET stock=0 WHERE id=$1", [second]);
      }
      return result;
    });
    let refusedResult: Awaited<ReturnType<typeof submitOrder>>;
    try { refusedResult = await submitOrder(refusedOwner, { ...form, requestKey: randomUUID(), quote: refusedQuote }); }
    finally { refusedQuery.mock.restore(); await schema.pool.query("UPDATE store_products SET stock=$2 WHERE id=$1", [second, secondStock]); }
    assert.equal(soldOut, true, "fitment preload query text changed — race hook did not fire");
    assert.deepEqual([refusedResult.error, refusedResult.products], ["stock", [second]]);
    assert.equal(await orderCount(), ordersBefore);

    // Re-running the schema keeps rows; deleting an order removes its record.
    await schema.pool.query(await readFile("db/commerce.sql", "utf8"));
    assert.equal((await agreementRow(placed.id)).length, 1);
    await schema.pool.query("DELETE FROM commerce_order_items WHERE order_id=$1", [bare.id]);
    await schema.pool.query("DELETE FROM commerce_orders WHERE id=$1", [bare.id]);
    assert.equal((await agreementRow(bare.id)).length, 0);
  } finally {
    await db.end();
    await schema.drop();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
