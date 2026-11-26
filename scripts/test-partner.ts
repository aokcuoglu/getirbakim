import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { minPartnerKeyLength, parsePartnerKeys, resolvePartner } from "../src/modules/partner/auth";
import { decodeOfferId, encodeOfferId, matchesOem, matchesPartNo, partnerAvailability, splitOemNumbers, toPartnerProduct, type PartnerCatalogRow } from "../src/modules/partner/dto";
import { cancellationRequest, partnerOrderStatus, resolveOrderLimitKurus, lineAmounts, toPartnerOrderDto, type PartnerOrderRow } from "../src/modules/partner/order-dto";
import { orderRequestSchema, quoteRequestSchema } from "../src/modules/partner/order-schema";
import { partnerReturnStatus, returnRequestSchema, toPartnerReturnDto, type PartnerReturnRow } from "../src/modules/partner/return-dto";
import { assertQuoteMatches, fingerprintOrderRequest, PartnerOrderError, partnerQuoteTtlMs, signQuote, verifyQuote, type QuotePayload } from "../src/modules/partner/quotes";
import { resolvePartnerDiscount, resolvePartnerDiscountBps, resolvePartnerPrice } from "../src/modules/partner/pricing";
import { createRateLimiter } from "../src/lib/rate-limit";
import { exactMatches, fitmentLevelOf, fitsFirst } from "../src/modules/partner/search-order";
import { buildPartnerOrderEvent, buildPartnerReturnEvent, parsePartnerWebhooks, signPartnerWebhook, webhookHeaders } from "../src/modules/partner/webhook-contract";
import { ttlCache } from "../src/lib/ttl-cache";
import { isPoolTimeout, isStatementTimeout } from "../src/lib/db-errors";

const key = "sk_".padEnd(minPartnerKeyLength + 4, "x");

test("partner keys: pairs parse, short or broken entries are skipped, first definition wins", () => {
  const keys = parsePartnerKeys(` bakimx:${key} , broken, other:short, :${key}x, second:${key}`);
  assert.deepEqual([...keys], [[key, "bakimx"]]);
  assert.equal(parsePartnerKeys(`a:${key}:with:colons`).get(`${key}:with:colons`), "a");
});

test("partner auth: only a configured bearer key authenticates", () => {
  const configured = `bakimx:${key}`;
  assert.deepEqual(resolvePartner(`Bearer ${key}`, configured), { code: "bakimx" });
  assert.deepEqual(resolvePartner(`bearer   ${key} `, configured), { code: "bakimx" });
  assert.equal(resolvePartner(`Bearer ${key}x`, configured), null);
  assert.equal(resolvePartner(key, configured), null);
  assert.equal(resolvePartner(null, configured), null);
  // No configured key is a closed gate.
  assert.equal(resolvePartner(`Bearer ${key}`, undefined), null);
  assert.equal(resolvePartner("Bearer ", "bakimx:"), null);
});

test("partner price: storefront price before VAT, exact decimals, discount floored at cost", () => {
  // 103.19 × 55.2105 × 1.30 = 7406.3229 TRY before VAT; the storefront sells it at round(× 1.20) = 888759 kuruş.
  const pricing = { nf: 103.19, exchange_rate: "55.2105000000", markup_percent: 30, vat_percent: 20 };
  const plain = resolvePartnerPrice(pricing, 888759, 0);
  assert.deepEqual(plain, { listPriceKurus: 740632, b2bPriceKurus: 740632, discountBps: 0, vatRateBps: 2000, currency: "TRY" });
  // Binary floating point would round 1.005 × 100 down.
  assert.equal(resolvePartnerPrice({ nf: "1.005", exchange_rate: 1, markup_percent: 0, vat_percent: 20 }, 121, 0).listPriceKurus, 101);
  // 10% off 117.00 is 105.30, still above the 100.00 cost; 30% off 105.00 would go below it and stops at cost.
  const discounted = resolvePartnerPrice({ nf: 100, exchange_rate: 1, markup_percent: 17, vat_percent: 20 }, 14040, 1000);
  assert.deepEqual([discounted.listPriceKurus, discounted.b2bPriceKurus, discounted.discountBps], [11700, 10530, 1000]);
  const floored = resolvePartnerPrice({ nf: 100, exchange_rate: 1, markup_percent: 5, vat_percent: 20 }, 12600, 3000);
  assert.deepEqual([floored.listPriceKurus, floored.b2bPriceKurus, floored.discountBps], [10500, 10000, 476]);
});

test("partner price: no storefront price or broken inputs mean no partner price", () => {
  const pricing = { nf: 10, exchange_rate: 1, markup_percent: 30, vat_percent: 20 };
  assert.equal(resolvePartnerPrice(pricing, null, 0).b2bPriceKurus, null);
  assert.equal(resolvePartnerPrice({ ...pricing, exchange_rate: null }, 1560, 0).listPriceKurus, null);
  assert.equal(resolvePartnerPrice({ ...pricing, nf: "1e3" }, 1560, 0).listPriceKurus, null);
  assert.equal(resolvePartnerPrice({ ...pricing, vat_percent: 0 }, 1300, 0).vatRateBps, 0);
});

test("partner price: an admin's fixed or campaign price is the partner's, VAT taken out, discounted, floored at cost (#580)", () => {
  // The formula would give 130.00 before VAT; the admin sells at 150.00 VAT included → 125.00 before VAT.
  const fixed = { source: "override", price_kind: "fixed", nf: 100, exchange_rate: 1, markup_percent: 30, vat_percent: 20 };
  assert.deepEqual(resolvePartnerPrice(fixed, 15000, 0), { listPriceKurus: 12500, b2bPriceKurus: 12500, discountBps: 0, vatRateBps: 2000, currency: "TRY" });
  const discounted = resolvePartnerPrice(fixed, 15000, 1000);
  assert.deepEqual([discounted.listPriceKurus, discounted.b2bPriceKurus, discounted.discountBps], [12500, 11250, 1000]);
  // 30% off 105.00 would be 73.50, below the 100.00 cost: the floor stops it at cost.
  const floored = resolvePartnerPrice(fixed, 12600, 3000);
  assert.deepEqual([floored.listPriceKurus, floored.b2bPriceKurus, floored.discountBps], [10500, 10000, 476]);
  // A price set below cost stays the admin's price (a warning, not a block): never raised to cost.
  const below = resolvePartnerPrice(fixed, 11000, 1000);
  assert.deepEqual([below.listPriceKurus, below.b2bPriceKurus, below.discountBps], [9167, 9167, 0]);
  // A running campaign is what the store sells, so the partner sees it too.
  const campaign = { ...fixed, price_kind: "sale", list_price_kurus: 15000 };
  const sale = resolvePartnerPrice(campaign, 13200, 0);
  assert.deepEqual([sale.listPriceKurus, sale.b2bPriceKurus], [11000, 11000]);
  // Exact half-up rounding: 3 × 100 / 120 = 2.5 → 3; 101 × 100 / 120 = 84.17 → 84; decimal and zero VAT.
  assert.equal(resolvePartnerPrice({ ...fixed, nf: "0.01" }, 3, 0).listPriceKurus, 3);
  assert.equal(resolvePartnerPrice({ ...fixed, nf: "0.01" }, 101, 0).listPriceKurus, 84);
  assert.equal(resolvePartnerPrice({ ...fixed, vat_percent: "18.50" }, 11850, 0).listPriceKurus, 10000);
  assert.deepEqual(resolvePartnerPrice({ ...fixed, vat_percent: 0 }, 15000, 0).listPriceKurus, 15000);
  // No storefront price (the formula cannot price the row): no partner price, override or not.
  assert.equal(resolvePartnerPrice(fixed, null, 0).listPriceKurus, null);
  assert.equal(resolvePartnerPrice({ ...fixed, vat_percent: null }, 15000, 0).listPriceKurus, null);
});

test("partner discount: unset, invalid and excessive rates", () => {
  assert.equal(resolvePartnerDiscountBps(undefined), 0);
  assert.equal(resolvePartnerDiscountBps("abc"), 0);
  assert.equal(resolvePartnerDiscountBps("-5"), 0);
  assert.equal(resolvePartnerDiscountBps("1500"), 1500);
  assert.equal(resolvePartnerDiscountBps("95000"), 9000);
});

test("partner discount (#1130): the panel value wins, 0 included; cleared falls back to the env rate, then none", () => {
  assert.deepEqual(resolvePartnerDiscount(1000, 500), { discountBps: 1000, source: "panel" });
  assert.deepEqual(resolvePartnerDiscount(0, 500), { discountBps: 0, source: "panel" });
  assert.deepEqual(resolvePartnerDiscount(null, 500), { discountBps: 500, source: "env" });
  assert.deepEqual(resolvePartnerDiscount(undefined, 0), { discountBps: 0, source: "none" });
  // Out-of-range stored values are clamped like the env rate.
  assert.deepEqual(resolvePartnerDiscount(12_000, 0), { discountBps: 9000, source: "panel" });
  // The resolved rate prices the row and the cost floor still holds: list 130.00 TL, cost 100.00 TL.
  const pricing = { nf: "100", exchange_rate: "1", markup_percent: "30", vat_percent: "20" };
  assert.equal(resolvePartnerPrice(pricing, 15600, resolvePartnerDiscount(1000, 0).discountBps).b2bPriceKurus, 11700);
  assert.deepEqual(resolvePartnerPrice(pricing, 15600, resolvePartnerDiscount(5000, 0).discountBps), { listPriceKurus: 13000, b2bPriceKurus: 10000, discountBps: 2308, vatRateBps: 2000, currency: "TRY" });
});

const row = (overrides: Partial<PartnerCatalogRow> = {}): PartnerCatalogRow => ({
  id: "0000a569-053e-4b84-a484-d510f04fab3b", supplier: "basbug", code: "LUK 510 0207 10", name: "DEBRIYAJ RULMANI", brand: "LUK",
  display_brand: "LUK", display_code: "LUK 510 0207 10", category: null, oem: "55248403; 55248403 ,9S51-7548-AA", price_kurus: 888759, available: true, stock_label: "Tedarikçide mevcut",
  pricing_snapshot: { nf: 103.19, exchange_rate: 55.2105, markup_percent: 30, vat_percent: 20, observed_at: "2026-11-10T08:00:00+03:00", source_fresh: true,
    stock: { stok: 7 }, company: "BASBUG", warehouse: "MERKEZ" } as PartnerCatalogRow["pricing_snapshot"],
  ...overrides,
});

test("partner availability follows the storefront's sellability", () => {
  assert.equal(partnerAvailability(row()), "IN_STOCK");
  assert.equal(partnerAvailability(row({ price_kurus: null })), "UNAVAILABLE");
  assert.equal(partnerAvailability(row({ pricing_snapshot: { ...row().pricing_snapshot, source_fresh: false } })), "SUPPLYABLE");
  assert.equal(partnerAvailability(row({ available: false, stock_label: "Tedarikçiye sevkiyat bekleniyor" })), "SUPPLYABLE");
  assert.equal(partnerAvailability(row({ available: false, stock_label: "Stokta yok" })), "UNAVAILABLE");
});

test("partner product DTO is contract 1.3, the 1.2 fields unchanged, and leaks no supplier internals", () => {
  const offer = row({ id: "11111111-2222-4333-8444-555555555555", supplier: "dinamik", available: false, stock_label: "Stokta yok",
    pricing_snapshot: { ...row().pricing_snapshot, observed_at: "2026-11-10T09:30:00Z" } });
  const product = toPartnerProduct(row(), { offers: [row(), offer], discountBps: 0, imageUrl: "https://getirbakim.com/api/product-media/x", vehicleTypeId: 1234, fitmentLevel: "guaranteed" });
  assert.equal(product.contractVersion, "1.3");
  // A 1.1/1.2 reader (BakımX) finds every field it reads; 1.3 only adds fitmentLevel (#1093).
  assert.deepEqual(Object.keys(product).sort(), ["availability", "b2bPriceKurus", "brandName", "categoryName", "contractVersion", "currency", "discountBps",
    "exactFitment", "fitmentLevel", "id", "imageUrl", "lastSyncedAt", "listPriceKurus", "manufacturerPartNumber", "name", "oemNumbers", "offers", "partNo",
    "references", "sourceProductId", "stockQty", "vatRateBps"]);
  assert.equal(product.fitmentLevel, "guaranteed");
  assert.equal(product.sourceProductId, row().id);
  assert.deepEqual(product.manufacturerPartNumber, { value: "LUK 510 0207 10", normalized: "LUK510020710" });
  assert.deepEqual(product.oemNumbers, ["55248403", "9S51-7548-AA"]);
  assert.deepEqual(product.references[1], { type: "OEM", value: "9S51-7548-AA", normalized: "9S517548AA", brand: null });
  assert.deepEqual(product.exactFitment, { requestedVehicleTypeId: 1234, status: "CONFIRMED", matchedVehicleTypeIds: [1234] });
  assert.equal(product.b2bPriceKurus, 740632);
  assert.equal(product.lastSyncedAt, "2026-11-10T09:30:00.000Z");
  assert.deepEqual(product.offers.map(item => [item.supplierDisplayName, item.availability, item.stockQty]), [["Başbuğ", "IN_STOCK", null], ["Dinamik", "UNKNOWN", null]]);
  assert.match(product.offers[0].selectedOfferId, /^offer_[0-9a-f]{32}$/);
  const json = JSON.stringify(product);
  for (const internal of [`"nf"`, "103.19", "exchange_rate", "markup", "BASBUG", "MERKEZ", `"stok"`, "warehouse", "company"]) assert.ok(!json.includes(internal), internal);
  assert.equal(toPartnerProduct(row(), { offers: [row()], discountBps: 0, imageUrl: null, vehicleTypeId: null, fitmentLevel: null }).exactFitment.status, "NOT_REQUESTED");
  // An admin price (#580) reaches the product and its offer from the row's price; no new internals leak.
  const fixed = row({ price_kurus: 960000, pricing_snapshot: { ...row().pricing_snapshot, source: "override", price_kind: "fixed", auto_price_kurus: 888759,
    fixed_price_kurus: 960000, cost_kurus: 569720 } as PartnerCatalogRow["pricing_snapshot"] });
  const overridden = toPartnerProduct(fixed, { offers: [fixed], discountBps: 0, imageUrl: null, vehicleTypeId: null, fitmentLevel: null });
  assert.deepEqual([overridden.listPriceKurus, overridden.b2bPriceKurus, overridden.offers[0].informationalPriceKurus], [800000, 800000, 800000]);
  for (const internal of ["auto_price", "fixed_price", "cost_kurus", "888759", "override"]) assert.ok(!JSON.stringify(overridden).includes(internal), internal);
  assert.equal(toPartnerProduct(row(), { offers: [row()], discountBps: 0, imageUrl: null, vehicleTypeId: 9, fitmentLevel: null }).exactFitment.status, "NOT_CONFIRMED");
});

test("partner fitment level: likely is reported but stays NOT_CONFIRMED; no vehicle means no level (#1093)", () => {
  const likely = toPartnerProduct(row(), { offers: [row()], discountBps: 0, imageUrl: null, vehicleTypeId: 9, fitmentLevel: "likely" });
  assert.deepEqual([likely.fitmentLevel, likely.exactFitment], ["likely", { requestedVehicleTypeId: 9, status: "NOT_CONFIRMED", matchedVehicleTypeIds: [] }]);
  assert.equal(toPartnerProduct(row(), { offers: [row()], discountBps: 0, imageUrl: null, vehicleTypeId: 9, fitmentLevel: null }).fitmentLevel, "unknown");
  const none = toPartnerProduct(row(), { offers: [row()], discountBps: 0, imageUrl: null, vehicleTypeId: null, fitmentLevel: "guaranteed" });
  assert.deepEqual([none.fitmentLevel, none.exactFitment.status], [null, "NOT_REQUESTED"]);
  // A fit of any grouped offer is the product's; an engine-type link beats a model fit.
  const typeFitted = new Set(["offer-b"]), modelFitted = new Set(["a", "c"]);
  assert.equal(fitmentLevelOf(["a", "offer-b"], typeFitted, modelFitted), "guaranteed");
  assert.equal(fitmentLevelOf(["c"], typeFitted, modelFitted), "likely");
  assert.equal(fitmentLevelOf(["d", "offer-d"], typeFitted, modelFitted), "unknown");
  // A type the admin removed from the product is a storefront mismatch: never likely, reported unknown.
  assert.equal(fitmentLevelOf(["c"], typeFitted, modelFitted, true), "unknown");
});

// The search's ranked candidates (rankedSearchDepth = 200): supplier rows `r0`…, every 10th a hand-entered store product.
const ranked = Array.from({ length: 200 }, (_, index) => ({
  ...row({ id: `r${index}`, code: `ART ${index}`, display_code: `ART ${index}`, oem: `OE-${index}` }), source: index % 10 === 9 ? "store" : "supplier",
}));

test("partner search: limit above one storefront page (24) and exact numbers ranked below it (#1093)", () => {
  const supplierRows = exactMatches(ranked, {});
  assert.equal(supplierRows.length, 180);
  assert.ok(supplierRows.every(item => item.source === "supplier"));
  // limit=30 returns 30 rows, the search's order kept.
  assert.deepEqual(fitsFirst(supplierRows, null, 30).map(item => item.id), supplierRows.slice(0, 30).map(item => item.id));
  // An exact part number or OEM ranked 150th is still found.
  assert.deepEqual(exactMatches(ranked, { partNo: "art-150" }).map(item => item.id), ["r150"]);
  assert.deepEqual(exactMatches(ranked, { oem: "oe 150" }).map(item => item.id), ["r150"]);
  // The store's manufacturer part number matches too (#602); a store product never does.
  const edited = [{ ...ranked[160], display_code: "XY 99" }, ranked[159]];
  assert.deepEqual(exactMatches(edited, { partNo: "xy99" }).map(item => item.id), ["r160"]);
  assert.deepEqual(exactMatches(edited, { partNo: "art159" }), []);
});

test("partner search: with a vehicle, guaranteed fits first, then likely, then the rest, nothing dropped (#1093)", () => {
  const rows = exactMatches(ranked, {}).slice(0, 12);
  const levels = new Map(rows.map(item => [item.id, "unknown" as const] as [string, "guaranteed" | "likely" | "unknown"]));
  for (const id of ["r11", "r3"]) levels.set(id, "likely");
  for (const id of ["r7", "r12"]) levels.set(id, "guaranteed");
  const ordered = fitsFirst(rows, levels, 30).map(item => item.id);
  assert.deepEqual(ordered, ["r7", "r12", "r3", "r11", "r0", "r1", "r2", "r4", "r5", "r6", "r8", "r10"]);
  // A fitting part ranked deep reaches a short first page; the rest still fill it.
  assert.deepEqual(fitsFirst(rows, levels, 3).map(item => item.id), ["r7", "r12", "r3"]);
  assert.deepEqual(fitsFirst(rows, new Map(), 4).map(item => item.id), ["r0", "r1", "r2", "r3"]);
});

test("partner response cache: a repeat within the window is not loaded again; it expires, failures are not kept (#1093)", async () => {
  let now = 0, loads = 0;
  const cache = ttlCache<number>(30_000, 2, () => now);
  const load = async () => ++loads;
  assert.deepEqual(await Promise.all([cache("fren", load), cache("fren", load)]), [1, 1]);
  now = 29_999;
  assert.equal(await cache("fren", load), 1);
  now = 30_000;
  assert.equal(await cache("fren", load), 2);
  await assert.rejects(cache("boom", async () => { throw new Error("db"); }));
  assert.equal(await cache("boom", load), 3);
  // Least recently used leaves first: "fren" was read after "boom" was stored, then "x" pushes "boom" out.
  assert.equal(await cache("fren", load), 2);
  await cache("x", load);
  assert.equal(await cache("fren", load), 2);
  assert.equal(await cache("boom", load), 5);
});

test("partner product shows the store brand and part number; partNo stays the supplier code (#602)", () => {
  const edited = row({ display_brand: "SCHAEFFLER", display_code: "510020710" });
  const product = toPartnerProduct(edited, { offers: [edited], discountBps: 0, imageUrl: null, vehicleTypeId: null, fitmentLevel: null });
  assert.equal(product.brandName, "SCHAEFFLER");
  assert.deepEqual(product.manufacturerPartNumber, { value: "510020710", normalized: "510020710" });
  assert.equal(product.partNo, "LUK 510 0207 10");
});

test("a hidden supplier OEM field (empty oem) gives no OEM numbers or references; the code still matches (#615)", () => {
  const hidden = row({ oem: "" });
  const product = toPartnerProduct(hidden, { offers: [hidden], discountBps: 0, imageUrl: null, vehicleTypeId: null, fitmentLevel: null });
  assert.deepEqual([product.oemNumbers, product.references], [[], []]);
  assert.ok(!matchesOem(hidden, "55248403"));
  assert.ok(matchesOem(hidden, "510020710"));
});

test("exact part and OEM numbers ignore separators and a supplier brand prefix", () => {
  assert.ok(matchesPartNo("LUK 510 0207 10", "510020710"));
  assert.ok(matchesPartNo("LUK 510 0207 10", "luk-510-0207-10"));
  assert.ok(matchesPartNo("OC 90", "oc90"));
  assert.ok(!matchesPartNo("LUK 510 0207 10", "5100207"));
  assert.ok(!matchesPartNo("39144550", ""));
  assert.ok(matchesOem(row(), "9s51 7548 aa"));
  assert.ok(!matchesOem(row(), "552484"));
  assert.deepEqual(splitOemNumbers(" | ,"), []);
});

test("rate limiter: fixed window per key", () => {
  let now = 0;
  const limit = createRateLimiter(2, 1000, () => now);
  assert.deepEqual([limit("a"), limit("a"), limit("b")].map(result => result.allowed), [true, true, true]);
  assert.deepEqual(limit("a"), { allowed: false, retryAfterSeconds: 1 });
  now = 1000;
  assert.equal(limit("a").allowed, true);
  // peek answers without counting.
  assert.deepEqual([limit.peek("a"), limit.peek("a"), limit.peek("c")].map(result => result.allowed), [true, true, true]);
  limit("a");
  assert.equal(limit.peek("a").allowed, false);
});

test("partner catalog reads only saleable rows, never the storefront's unavailable products (#475)", async () => {
  for (const file of await readdir("src/modules/partner")) {
    const source = await readFile(`src/modules/partner/${file}`, "utf8");
    assert.doesNotMatch(source, /storefront_catalog|storefrontCatalogSql|commerce_unavailable_items|getStorefrontProduct/, file);
  }
});

// Partner orders (#426): pure parts of the quote, request and DTO contract. scripts/test-partner-orders.ts covers the database flow.
const secret = "q".repeat(40);
const offerA = encodeOfferId("0000a569-053e-4b84-a484-d510f04fab3b");
const offerB = encodeOfferId("11111111-2222-4333-8444-555555555555");
const quote = (overrides: Partial<QuotePayload> = {}): QuotePayload => ({
  version: 1, partner: "bakimx", shippingKurus: 15000, issuedAt: 1_000, expiresAt: 1_000 + partnerQuoteTtlMs,
  lines: [{ selectedOfferId: offerA, quantity: 2, unitNetKurus: 740632 }, { selectedOfferId: offerB, quantity: 1, unitNetKurus: 1200 }], ...overrides,
});
const refusal = (code: string) => (error: unknown) => error instanceof PartnerOrderError && error.code === code;

test("offer ids round-trip; anything else is not an offer", () => {
  assert.equal(offerA, "offer_0000a569053e4b84a484d510f04fab3b");
  assert.equal(decodeOfferId(offerA), "0000a569-053e-4b84-a484-d510f04fab3b");
  for (const bad of ["offer_123", "offer_0000A569053E4B84A484D510F04FAB3B", "0000a569053e4b84a484d510f04fab3b", `${offerA}0`]) assert.equal(decodeOfferId(bad), null, bad);
});

test("partner quote: signed, verified, tamper-proof, fails closed without a secret", () => {
  const token = signQuote(quote(), secret);
  assert.deepEqual(verifyQuote(token, secret), quote());
  // Another secret, a changed payload or a changed signature is QUOTE_CHANGED.
  assert.throws(() => verifyQuote(token, "z".repeat(40)), refusal("QUOTE_CHANGED"));
  const [body, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...quote(), lines: [{ selectedOfferId: offerA, quantity: 2, unitNetKurus: 1 }] })).toString("base64url");
  assert.throws(() => verifyQuote(`${forged}.${signature}`, secret), refusal("QUOTE_CHANGED"));
  assert.throws(() => verifyQuote(`${body}.${signature}x`, secret), refusal("QUOTE_CHANGED"));
  assert.throws(() => verifyQuote(`${body}`, secret), refusal("QUOTE_CHANGED"));
  assert.throws(() => verifyQuote(`${token}.x`, secret), refusal("QUOTE_CHANGED"));
  // No secret, or a short one, is a closed gate (503), for signing and for verifying.
  for (const missing of [undefined, "", "short-secret"]) {
    assert.throws(() => signQuote(quote(), missing), refusal("QUOTE_CONFIGURATION_UNAVAILABLE"));
    assert.throws(() => verifyQuote(token, missing), refusal("QUOTE_CONFIGURATION_UNAVAILABLE"));
  }
  // The token carries prices but no supplier internals.
  assert.doesNotMatch(Buffer.from(body, "base64url").toString(), /nf|markup|exchange|company|supplier/);
});

test("partner quote: partner, lines and expiry are checked", () => {
  const lines = quote().lines;
  assert.doesNotThrow(() => assertQuoteMatches(quote(), "bakimx", [...lines].reverse(), 2_000));
  assert.throws(() => assertQuoteMatches(quote(), "other", lines, 2_000), refusal("QUOTE_CHANGED"));
  assert.throws(() => assertQuoteMatches(quote(), "bakimx", lines.slice(1), 2_000), refusal("QUOTE_CHANGED"));
  assert.throws(() => assertQuoteMatches(quote(), "bakimx", [{ ...lines[0], quantity: 3 }, lines[1]], 2_000), refusal("QUOTE_CHANGED"));
  assert.throws(() => assertQuoteMatches(quote(), "bakimx", [{ ...lines[0], unitNetKurus: 740631 }, lines[1]], 2_000), refusal("QUOTE_CHANGED"));
  // Valid for 15 minutes, then QUOTE_EXPIRED (409).
  assert.doesNotThrow(() => assertQuoteMatches(quote(), "bakimx", lines, 1_000 + partnerQuoteTtlMs - 1));
  assert.throws(() => assertQuoteMatches(quote(), "bakimx", lines, 1_000 + partnerQuoteTtlMs), (error: unknown) =>
    error instanceof PartnerOrderError && error.code === "QUOTE_EXPIRED" && error.status === 409);
});

const address = { recipientName: "Usta Oto Servis", phone: "0532 000 00 00", province: "istanbul", district: "kadıköy", addressLine: "Test Mahallesi 1. Sokak No 2" };
const orderBody = (overrides: Record<string, unknown> = {}) => ({
  confirmationToken: "x.y", lines: [{ selectedOfferId: offerA, quantity: 2, expectedUnitNetKurus: 740632 }], shippingAddress: address, ...overrides,
});

test("partner order request: strict body, Turkish address matched, offers distinct", () => {
  const parsed = orderRequestSchema.parse(orderBody());
  assert.deepEqual([parsed.shippingAddress.province, parsed.shippingAddress.district, parsed.shippingAddress.postalCode, parsed.shippingAddress.email, parsed.note],
    ["İstanbul", "Kadıköy", null, "", ""]);
  // The phone is stored as the carrier label needs it; a number that is not Turkish is refused.
  assert.equal(parsed.shippingAddress.phone, "+905320000000");
  assert.equal(orderRequestSchema.parse(orderBody({ shippingAddress: { ...address, phone: "+90 (216) 555 12 34" } })).shippingAddress.phone, "+902165551234");
  assert.equal(orderRequestSchema.safeParse(orderBody({ shippingAddress: { ...address, phone: "0632 000 00 00" } })).success, false);
  assert.equal(orderRequestSchema.safeParse(orderBody({ shippingAddress: { ...address, phone: "+44 20 7946 0958" } })).success, false);
  // A partner identity in the body, an unknown district, a postal code of another province and a repeated offer are refused.
  assert.equal(orderRequestSchema.safeParse(orderBody({ partner: "other" })).success, false);
  assert.equal(orderRequestSchema.safeParse(orderBody({ shippingAddress: { ...address, district: "Çankaya" } })).success, false);
  assert.equal(orderRequestSchema.safeParse(orderBody({ shippingAddress: { ...address, postalCode: "06100" } })).success, false);
  assert.equal(orderRequestSchema.safeParse(orderBody({ shippingAddress: { ...address, postalCode: "34710" } })).success, true);
  assert.equal(orderRequestSchema.safeParse(orderBody({ lines: [orderBody().lines[0], orderBody().lines[0]] })).success, false);
  assert.equal(orderRequestSchema.safeParse(orderBody({ lines: [{ ...orderBody().lines[0], quantity: 100 }] })).success, false);
  assert.equal(orderRequestSchema.safeParse(orderBody({ lines: [] })).success, false);
  assert.equal(quoteRequestSchema.safeParse({ lines: [{ selectedOfferId: offerA, quantity: 1 }, { selectedOfferId: offerB, quantity: 99 }] }).success, true);
  assert.equal(quoteRequestSchema.safeParse({ lines: [{ selectedOfferId: "offer_x", quantity: 1 }] }).success, false);
});

test("partner order fingerprint: same body same hash whatever the key order; any change differs", () => {
  const parsed = orderRequestSchema.parse(orderBody());
  const reordered = orderRequestSchema.parse({ shippingAddress: { ...address }, lines: orderBody().lines, confirmationToken: "x.y" });
  assert.equal(fingerprintOrderRequest(parsed), fingerprintOrderRequest(reordered));
  assert.match(fingerprintOrderRequest(parsed), /^[0-9a-f]{64}$/);
  assert.notEqual(fingerprintOrderRequest(parsed), fingerprintOrderRequest(orderRequestSchema.parse(orderBody({ note: "Kapıya bırakın" }))));
  assert.notEqual(fingerprintOrderRequest(parsed), fingerprintOrderRequest(orderRequestSchema.parse(orderBody({ lines: [{ ...orderBody().lines[0], quantity: 3 }] }))));
});

test("partner order limit: unset or malformed refuses orders", () => {
  for (const raw of [undefined, null, "", "0", "-5", "1e6", "12.5", "abc"]) assert.equal(resolveOrderLimitKurus(raw), null, String(raw));
  assert.equal(resolveOrderLimitKurus(" 5000000 "), 5_000_000);
});

test("partner line VAT is computed once per line from the line net, like an e-invoice line", () => {
  // 1001 × 99 = 99099 net; 20% of it is 19819.8 → 19820. Per-unit rounding would give 200 × 99 = 19800.
  assert.deepEqual(lineAmounts(1001, 99, 2000), { lineNetKurus: 99099, lineVatKurus: 19820, lineGrossKurus: 118919 });
  assert.deepEqual(lineAmounts(740632, 2, 2000), { lineNetKurus: 1481264, lineVatKurus: 296253, lineGrossKurus: 1777517 });
  assert.deepEqual(lineAmounts(1001, 1, 1850), { lineNetKurus: 1001, lineVatKurus: 185, lineGrossKurus: 1186 });
  assert.deepEqual(lineAmounts(5000, 3, 0), { lineNetKurus: 15000, lineVatKurus: 0, lineGrossKurus: 15000 });
});

test("partner order DTO: status names, line amounts, totals with shipping; no supplier internals", () => {
  assert.deepEqual(["pending", "confirmed", "shipped", "delivered", "cancelled", "awaiting_payment"].map(partnerOrderStatus),
    ["REQUESTED", "CONFIRMED", "SHIPPED", "COMPLETED", "CANCELLED", "REQUESTED"]);
  const order: PartnerOrderRow = {
    id: "9b0f8a1e-0000-4000-8000-000000000001", number: "1042", request_key: "7c1e3a52-1111-4111-8111-111111111111", status: "cancelled", payment_status: "on_account",
    total_kurus: String(1777517 + 15000), shipping_kurus: "15000", note: "", customer_name: "Usta Oto Servis", phone: "05320000000", email: "",
    delivery_province: "İstanbul", delivery_district: "Kadıköy", delivery_address_line: "Test Mahallesi 1. Sokak No 2", delivery_postal_code: null,
    carrier: null, carrier_name: null, tracking_no: null, tracking_url: null, shipped_at: null, delivered_at: null,
    cancelled_by: "admin", cancelled_at: new Date("2026-11-18T10:00:00Z"), created_at: new Date("2026-11-18T09:00:00Z"),
    cancel_requested_at: null, cancel_request_rejected_at: null,
  };
  const dto = toPartnerOrderDto(order, [{ product_id: "0000a569-053e-4b84-a484-d510f04fab3b", code: "LUK 510 0207 10", name: "DEBRIYAJ RULMANI", quantity: 2,
    unit_price_kurus: "888759", pricing_snapshot: { nf: 103.19, company: "BASBUG", markup_percent: 30,
      partner: { unit_net_kurus: 740632, vat_rate_bps: 2000, line_net_kurus: 1481264, line_vat_kurus: 296253, line_gross_kurus: 1777517 } } }]);
  assert.equal(dto.contractVersion, "2.0");
  assert.deepEqual([dto.status, dto.paymentStatus, dto.cancelledBy, dto.number, dto.shipment], ["CANCELLED", "ON_ACCOUNT", "GETIRBAKIM", 1042, null]);
  assert.deepEqual(dto.totals, { netKurus: 1481264, vatKurus: 296253, shippingKurus: 15000, grossKurus: 1792517 });
  assert.deepEqual(dto.lines[0], { selectedOfferId: offerA, partNo: "LUK 510 0207 10", name: "DEBRIYAJ RULMANI", quantity: 2,
    unitNetKurus: 740632, vatRateBps: 2000, lineNetKurus: 1481264, lineVatKurus: 296253, lineGrossKurus: 1777517 });
  assert.equal(dto.shippingAddress.email, null);
  const json = JSON.stringify(dto);
  for (const internal of [`"nf"`, "103.19", "BASBUG", "markup", "owner", "fingerprint", "payment_status"]) assert.ok(!json.includes(internal), internal);
  const shipped = toPartnerOrderDto({ ...order, status: "shipped", cancelled_by: null, cancelled_at: null, carrier: "yurtici", tracking_no: "123456789012",
    tracking_url: "https://example.invalid/t", shipped_at: new Date("2026-11-19T08:00:00Z") }, []);
  assert.deepEqual([shipped.status, shipped.cancelledBy, shipped.shipment?.trackingNo, shipped.shipment?.shippedAt], ["SHIPPED", null, "123456789012", "2026-11-19T08:00:00.000Z"]);
});

test("partner order DTO: the cancel request after confirmation is pending, approved or rejected", () => {
  const base = { status: "confirmed", cancelled_at: null, cancel_requested_at: null, cancel_request_rejected_at: null };
  const requested = new Date("2026-11-19T08:00:00Z"), decided = new Date("2026-11-19T09:00:00Z");
  assert.equal(cancellationRequest(base), null);
  assert.deepEqual(cancellationRequest({ ...base, cancel_requested_at: requested }),
    { status: "PENDING", requestedAt: "2026-11-19T08:00:00.000Z", decidedAt: null });
  assert.deepEqual(cancellationRequest({ ...base, status: "cancelled", cancelled_at: decided, cancel_requested_at: requested }),
    { status: "APPROVED", requestedAt: "2026-11-19T08:00:00.000Z", decidedAt: "2026-11-19T09:00:00.000Z" });
  // A rejected request stays rejected after the order ships.
  assert.deepEqual(cancellationRequest({ ...base, status: "shipped", cancel_requested_at: requested, cancel_request_rejected_at: decided }),
    { status: "REJECTED", requestedAt: "2026-11-19T08:00:00.000Z", decidedAt: "2026-11-19T09:00:00.000Z" });
});

test("partner return request body (#1007): strict, offers once, quantity and reason bounds, reasons map to store reasons", () => {
  const line = { selectedOfferId: offerA, quantity: 1, reason: "DEFECTIVE" };
  assert.deepEqual(returnRequestSchema.parse({ lines: [line] }), { lines: [{ selectedOfferId: offerA, quantity: 1, reason: "defective" }], note: "" });
  const reasons = ["NOT_FIT", "WRONG_ITEM", "DAMAGED", "DEFECTIVE", "CHANGED_MIND", "OTHER"].map(reason => returnRequestSchema.parse({ lines: [{ ...line, reason }] }).lines[0].reason);
  assert.deepEqual(reasons, ["not_fit", "wrong_item", "damaged", "defective", "changed_mind", "other"]);
  assert.equal(returnRequestSchema.parse({ lines: [line], note: "  kutusu açılmadı  " }).note, "kutusu açılmadı");
  for (const invalid of [
    {}, { lines: [] }, { lines: [line], partner: "other" }, { lines: [{ ...line, extra: 1 }] }, { lines: [line, { ...line, quantity: 2 }] },
    { lines: [{ ...line, quantity: 0 }] }, { lines: [{ ...line, quantity: 100 }] }, { lines: [{ ...line, quantity: 1.5 }] },
    { lines: [{ ...line, reason: "defective" }] }, { lines: [{ ...line, reason: "BROKEN" }] }, { lines: [{ ...line, selectedOfferId: "offer_x" }] },
    { lines: [line], note: "x".repeat(1001) }, { lines: Array.from({ length: 21 }, (_, index) => ({ ...line, selectedOfferId: `offer_${String(index).padStart(32, "0")}` })) },
  ]) assert.equal(returnRequestSchema.safeParse(invalid).success, false, JSON.stringify(invalid).slice(0, 80));
});

test("partner return DTO (#1007): statuses, amounts at the order's unit price per returned quantity; no supplier internals", () => {
  assert.deepEqual(["requested", "approved", "rejected"].map(partnerReturnStatus), ["REQUESTED", "APPROVED", "REJECTED"]);
  const request: PartnerReturnRow = { id: "4f1c0000-0000-4000-8000-000000000002", order_id: "9b0f8a1e-0000-4000-8000-000000000001",
    request_key: "7c1e3a52-2222-4222-8222-222222222222", status: "approved", note: "Kusurlu", requested_at: new Date("2026-11-21T08:00:00Z"), decided_at: new Date("2026-11-21T09:00:00Z") };
  const snapshot = { nf: 103.19, company: "BASBUG", markup_percent: 30,
    partner: { unit_net_kurus: 740632, vat_rate_bps: 2000, line_net_kurus: 2221896, line_vat_kurus: 444379, line_gross_kurus: 2666275 } };
  const dto = toPartnerReturnDto(request, [
    { product_id: "0000a569-053e-4b84-a484-d510f04fab3b", code: "LUK 510 0207 10", name: "DEBRIYAJ RULMANI", ordered_quantity: 3, quantity: 2, reason: "defective",
      unit_price_kurus: "888759", pricing_snapshot: snapshot },
    // A hand-edited line without the partner price: the unit gross with no VAT, like the order DTO.
    { product_id: "0000a569-053e-4b84-a484-d510f04fab3c", code: "X-1", name: "Filtre", ordered_quantity: 1, quantity: 1, reason: "not_fit",
      unit_price_kurus: "1200", pricing_snapshot: {} },
  ]);
  const first = lineAmounts(740632, 2, 2000);
  assert.deepEqual([dto.contractVersion, dto.status, dto.orderId, dto.idempotencyKey, dto.requestedAt, dto.decidedAt, dto.note],
    ["2.1", "APPROVED", request.order_id, request.request_key, "2026-11-21T08:00:00.000Z", "2026-11-21T09:00:00.000Z", "Kusurlu"]);
  assert.deepEqual(dto.lines[0], { selectedOfferId: offerA, partNo: "LUK 510 0207 10", name: "DEBRIYAJ RULMANI", quantity: 2, reason: "DEFECTIVE",
    unitNetKurus: 740632, vatRateBps: 2000, ...first });
  assert.deepEqual(dto.lines[1], { selectedOfferId: encodeOfferId("0000a569-053e-4b84-a484-d510f04fab3c"), partNo: "X-1", name: "Filtre", quantity: 1, reason: "NOT_FIT",
    unitNetKurus: 1200, vatRateBps: 0, lineNetKurus: 1200, lineVatKurus: 0, lineGrossKurus: 1200 });
  assert.deepEqual(dto.totals, { netKurus: first.lineNetKurus + 1200, vatKurus: first.lineVatKurus, grossKurus: first.lineGrossKurus + 1200 });
  assert.equal(toPartnerReturnDto({ ...request, status: "requested", decided_at: null }, []).decidedAt, null);
  const json = JSON.stringify(dto);
  for (const internal of [`"nf"`, "103.19", "BASBUG", "markup", "fingerprint", "partner_code", "888759"]) assert.ok(!json.includes(internal), internal);
});

test("partner guard: a valid key is limited per partner only; failed key checks per edge address (not X-Real-IP) (#1093)", async () => {
  const { NextRequest } = await import("next/server");
  const { partnerGuard } = await import("../src/modules/partner/guard");
  const originalKeys = process.env.PARTNER_API_KEYS;
  process.env.PARTNER_API_KEYS = `bakimx:${key},other:${key}y`;
  try {
    const request = (headers: Record<string, string>) => new NextRequest("https://getirbakim.com/api/partner/v1/orders", { headers });
    const unlimited = Object.assign(() => ({ allowed: true as const }), { peek: () => ({ allowed: true as const }) });
    const status = (result: ReturnType<typeof partnerGuard>) => "response" in result ? result.response.status : result.partner.code;
    // A client-chosen X-Real-IP and the first X-Forwarded-For hop are ignored; CloudFront's viewer address wins.
    const seen: string[] = [];
    const address = Object.assign((value: string) => { seen.push(value); return { allowed: true as const }; }, { peek: () => ({ allowed: true as const }) });
    partnerGuard(request({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1, 10.0.0.7", authorization: "Bearer wrong-key-wrong-key" }), { address, partner: unlimited });
    partnerGuard(request({ "x-real-ip": "203.0.113.9", "cloudfront-viewer-address": "198.51.100.20:46532" }), { address, partner: unlimited });
    // A valid key does not count against its address.
    partnerGuard(request({ "x-forwarded-for": "10.0.0.7", authorization: `Bearer ${key}` }), { address, partner: unlimited });
    assert.deepEqual(seen, ["10.0.0.7", "198.51.100.20"]);
    // One server address carries all of a partner's workshops: far past the address budget, only the partner's applies.
    const perAddress = createRateLimiter(2, 60_000), perPartner = createRateLimiter(5, 60_000);
    const limiters = { address: perAddress, partner: perPartner };
    const valid = Array.from({ length: 5 }, () => status(partnerGuard(request({ "x-forwarded-for": "10.0.0.1", authorization: `Bearer ${key}` }), limiters)));
    assert.deepEqual(valid, Array(5).fill("bakimx"));
    const over = partnerGuard(request({ "x-forwarded-for": "10.0.0.9", authorization: `Bearer ${key}` }), limiters);
    assert.ok("response" in over && over.response.status === 429 && over.response.headers.get("retry-after") === "60");
    assert.equal(status(partnerGuard(request({ "x-forwarded-for": "10.0.0.1", authorization: `Bearer ${key}y` }), limiters)), "other");
    // Missing or wrong keys count per address: 401 within the budget, then 429 before any key is checked, even a right one.
    const guessing = [`Bearer ${key}x`, "", `Bearer ${key}z`].map(authorization =>
      status(partnerGuard(request({ "x-forwarded-for": "10.0.0.2", ...authorization ? { authorization } : {} }), limiters)));
    assert.deepEqual(guessing, [401, 401, 429]);
    assert.equal(status(partnerGuard(request({ "x-forwarded-for": "10.0.0.2", authorization: `Bearer ${key}y` }), limiters)), 429);
    // The partner's own address is unaffected by another address guessing.
    assert.equal(status(partnerGuard(request({ "x-forwarded-for": "10.0.0.1", authorization: `Bearer ${key}y` }), limiters)), "other");
  } finally {
    if (originalKeys === undefined) delete process.env.PARTNER_API_KEYS; else process.env.PARTNER_API_KEYS = originalKeys;
  }
});

test("database timeouts: a cancelled statement (57014) and pg-pool's acquire timeouts; nothing else (#1395)", () => {
  assert.equal(isStatementTimeout(Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" })), true);
  assert.equal(isStatementTimeout({ code: "57014" }), true);
  for (const other of [Object.assign(new Error("deadlock detected"), { code: "40P01" }), new Error("57014"), "57014", null, undefined, { code: 57014 }])
    assert.equal(isStatementTimeout(other), false);
  assert.equal(isPoolTimeout(new Error("timeout exceeded when trying to connect")), true);
  assert.equal(isPoolTimeout(new Error("Connection terminated due to connection timeout")), true);
  for (const other of [new Error("Connection terminated unexpectedly"), new Error("timeout exceeded when trying to connect, again"), { message: "timeout exceeded when trying to connect" }, null])
    assert.equal(isPoolTimeout(other), false);
});

test("partner search failures (#1395): a timeout is 503 SEARCH_UNAVAILABLE with Retry-After and no-store; anything else 500", async () => {
  const { partnerSearchFailure, partnerUnavailable } = await import("../src/modules/partner/guard");
  const unavailable = partnerUnavailable();
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("retry-after"), "5");
  assert.equal(unavailable.headers.get("cache-control"), "no-store");
  assert.deepEqual(await unavailable.json(), { error: { code: "SEARCH_UNAVAILABLE", message: "Search is temporarily unavailable. Retry later." } });
  assert.equal(partnerUnavailable(12).headers.get("retry-after"), "12");
  for (const error of [{ code: "57014" }, new Error("timeout exceeded when trying to connect")]) {
    const failure = partnerSearchFailure(error);
    assert.deepEqual([failure.timeout, failure.response.status, failure.response.headers.get("retry-after")], [true, 503, "5"]);
    assert.equal((await failure.response.json()).error.code, "SEARCH_UNAVAILABLE");
  }
  const failed = partnerSearchFailure(new Error("relation \"x\" does not exist"));
  assert.deepEqual([failed.timeout, failed.response.status, failed.response.headers.get("retry-after"), failed.response.headers.get("cache-control")], [false, 500, null, "no-store"]);
  assert.deepEqual(await failed.response.json(), { error: { code: "INTERNAL_ERROR", message: "Partner search failed." } });
});

const webhookSecret = "test-webhook-secret-0123456789abcdef";

test("partner webhooks (#1002): endpoints parse per partner; a broken entry or broken JSON is reported, never fatal", () => {
  const valid = { url: "https://bakimx.example.invalid/hooks/getirbakim", secret: webhookSecret, enabled: true };
  const one = parsePartnerWebhooks(JSON.stringify({ bakimx: valid }), true);
  assert.deepEqual([...one.endpoints], [["bakimx", { url: valid.url, secret: webhookSecret }]]);
  assert.deepEqual([one.invalid.size, one.parseError], [0, false]);
  // Unset is "no webhooks"; set but unreadable is a parse error (events wait).
  for (const raw of [undefined, null, "", "  "]) assert.deepEqual(parsePartnerWebhooks(raw, true), { endpoints: new Map(), invalid: new Map(), parseError: false }, String(raw));
  for (const raw of ["{", "[]", "\"text\"", "null", "42"]) {
    const config = parsePartnerWebhooks(raw, true);
    assert.deepEqual([config.endpoints.size, config.parseError], [0, true], raw);
  }
  const entries = {
    bakimx: valid,
    short: { ...valid, secret: "x".repeat(31) },
    plain: { ...valid, url: "http://plain.example.invalid/hook" },
    creds: { ...valid, url: "https://user:pass@creds.example.invalid/hook" },
    off: { ...valid, enabled: false },
    notUrl: { ...valid, url: "not a url" },
    ftp: { ...valid, url: "ftp://files.example.invalid/hook" },
    missing: { url: valid.url },
    other: { url: "https://other.example.invalid/hook", secret: "y".repeat(32) },
  };
  // One bad entry keeps the others; http is refused only in production. Reasons never carry the secret.
  const production = parsePartnerWebhooks(JSON.stringify(entries), true);
  assert.deepEqual([...production.endpoints.keys()], ["bakimx", "other"]);
  assert.deepEqual(Object.fromEntries(production.invalid), {
    short: "secret shorter than 32 characters", plain: "URL is not https", creds: "URL carries credentials", off: "disabled",
    notUrl: "URL is not valid", ftp: "URL is not https", missing: "entry needs url and secret strings",
  });
  const local = parsePartnerWebhooks(JSON.stringify(entries), false);
  assert.deepEqual([...local.endpoints.keys()], ["bakimx", "plain", "other"]);
  assert.equal(local.invalid.get("ftp"), "URL is not http(s)");
});

test("partner webhooks (#1002): the signature is v1= HMAC-SHA256 over timestamp.body, and the headers carry it", () => {
  assert.equal(signPartnerWebhook(webhookSecret, "1767225600", '{"eventId":"e1"}'),
    "v1=3d23b84b1e6c09b71354f18c44be04f6c4cce3dae971a0304540f9f44315d567");
  assert.notEqual(signPartnerWebhook(webhookSecret, "1767225601", '{"eventId":"e1"}'), signPartnerWebhook(webhookSecret, "1767225600", '{"eventId":"e1"}'));
  assert.deepEqual(webhookHeaders({ eventId: "e1", eventType: "partner.order.updated", timestamp: "1767225600", signature: "v1=ab" }), {
    "Content-Type": "application/json", "User-Agent": "GetirBakim-Webhooks/1", "X-GetirBakim-Event-Id": "e1",
    "X-GetirBakim-Event-Type": "partner.order.updated", "X-GetirBakim-Timestamp": "1767225600", "X-GetirBakim-Signature": "v1=ab",
  });
});

test("partner webhooks (#1002): the event body wraps the order DTO and leaks no supplier internals", () => {
  const order: PartnerOrderRow = {
    id: "9b0f8a1e-0000-4000-8000-000000000002", number: "1043", request_key: "7c1e3a52-1111-4111-8111-111111111112", status: "shipped", payment_status: "on_account",
    total_kurus: "1777517", shipping_kurus: "0", note: "", customer_name: "Usta Oto Servis", phone: "05320000000", email: "",
    delivery_province: "İstanbul", delivery_district: "Kadıköy", delivery_address_line: "Test Mahallesi 1. Sokak No 2", delivery_postal_code: null,
    carrier: "yurtici", carrier_name: null, tracking_no: "123456789012", tracking_url: null, shipped_at: new Date("2026-11-19T10:00:00Z"), delivered_at: null,
    cancelled_by: null, cancelled_at: null, created_at: new Date("2026-11-18T09:00:00Z"), cancel_requested_at: null, cancel_request_rejected_at: null,
  };
  const dto = toPartnerOrderDto(order, [{ product_id: "0000a569-053e-4b84-a484-d510f04fab3b", code: "LUK 510 0207 10", name: "DEBRIYAJ RULMANI", quantity: 2,
    unit_price_kurus: "888759", pricing_snapshot: { nf: 103.19, company: "BASBUG", supplier: "basbug", cost_kurus: 569720, markup_percent: 30,
      partner: { unit_net_kurus: 740632, vat_rate_bps: 2000, line_net_kurus: 1481264, line_vat_kurus: 296253, line_gross_kurus: 1777517 } } }]);
  const body = buildPartnerOrderEvent({ eventId: "e2", occurredAt: new Date("2026-11-19T10:00:01Z"), partnerId: "bakimx", order: dto });
  const event = JSON.parse(body);
  assert.deepEqual(Object.keys(event), ["specVersion", "eventId", "eventType", "occurredAt", "partnerId", "order"]);
  assert.deepEqual([event.specVersion, event.eventId, event.eventType, event.occurredAt, event.partnerId], ["1.0", "e2", "partner.order.updated", "2026-11-19T10:00:01.000Z", "bakimx"]);
  assert.deepEqual(event.order, JSON.parse(JSON.stringify(dto)));
  for (const internal of [`"nf"`, "103.19", "BASBUG", "basbug", "cost", "569720", "markup", "fingerprint", "payment_status"]) assert.ok(!body.includes(internal), internal);
});

test("partner webhooks (#1002): the return event wraps the Return object under `return` and leaks no supplier internals", () => {
  const request: PartnerReturnRow = {
    id: "5d2c1b0a-0000-4000-8000-000000000003", order_id: "9b0f8a1e-0000-4000-8000-000000000002", request_key: "7c1e3a52-1111-4111-8111-111111111113",
    status: "approved", note: "Kutusu hasarlı", requested_at: new Date("2026-11-20T09:00:00Z"), decided_at: new Date("2026-11-20T11:00:00Z"),
  };
  const dto = toPartnerReturnDto(request, [{ product_id: "0000a569-053e-4b84-a484-d510f04fab3b", code: "LUK 510 0207 10", name: "DEBRIYAJ RULMANI", quantity: 1,
    ordered_quantity: 2, reason: "defective", unit_price_kurus: "888759", pricing_snapshot: { nf: 103.19, company: "BASBUG", supplier: "basbug", cost_kurus: 569720,
      markup_percent: 30, partner: { unit_net_kurus: 740632, vat_rate_bps: 2000, line_net_kurus: 1481264, line_vat_kurus: 296253, line_gross_kurus: 1777517 } } }]);
  const body = buildPartnerReturnEvent({ eventId: "e3", occurredAt: new Date("2026-11-20T11:00:01Z"), partnerId: "bakimx", return: dto });
  const event = JSON.parse(body);
  assert.deepEqual(Object.keys(event), ["specVersion", "eventId", "eventType", "occurredAt", "partnerId", "return"]);
  assert.deepEqual([event.specVersion, event.eventId, event.eventType, event.occurredAt, event.partnerId], ["1.0", "e3", "partner.return.updated", "2026-11-20T11:00:01.000Z", "bakimx"]);
  assert.deepEqual(event.return, JSON.parse(JSON.stringify(dto)));
  assert.deepEqual([event.return.contractVersion, event.return.status], ["2.1", "APPROVED"]);
  for (const internal of [`"nf"`, "103.19", "BASBUG", "basbug", "cost", "569720", "markup", "fingerprint", "partner_code"]) assert.ok(!body.includes(internal), internal);
});
