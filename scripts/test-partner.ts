import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { minPartnerKeyLength, parsePartnerKeys, resolvePartner } from "../src/modules/partner/auth";
import { matchesOem, matchesPartNo, partnerAvailability, splitOemNumbers, toPartnerProduct, type PartnerCatalogRow } from "../src/modules/partner/dto";
import { resolvePartnerDiscountBps, resolvePartnerPrice } from "../src/modules/partner/pricing";
import { createRateLimiter } from "../src/modules/partner/rate-limit";

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

test("partner product DTO keeps the 1.2 contract and leaks no supplier internals", () => {
  const offer = row({ id: "11111111-2222-4333-8444-555555555555", supplier: "dinamik", available: false, stock_label: "Stokta yok",
    pricing_snapshot: { ...row().pricing_snapshot, observed_at: "2026-11-10T09:30:00Z" } });
  const product = toPartnerProduct(row(), { offers: [row(), offer], discountBps: 0, imageUrl: "https://getirbakim.com/api/product-media/x", vehicleTypeId: 1234, fitted: true });
  assert.equal(product.contractVersion, "1.2");
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
  assert.equal(toPartnerProduct(row(), { offers: [row()], discountBps: 0, imageUrl: null, vehicleTypeId: null, fitted: false }).exactFitment.status, "NOT_REQUESTED");
  // An admin price (#580) reaches the product and its offer from the row's price; no new internals leak.
  const fixed = row({ price_kurus: 960000, pricing_snapshot: { ...row().pricing_snapshot, source: "override", price_kind: "fixed", auto_price_kurus: 888759,
    fixed_price_kurus: 960000, cost_kurus: 569720 } as PartnerCatalogRow["pricing_snapshot"] });
  const overridden = toPartnerProduct(fixed, { offers: [fixed], discountBps: 0, imageUrl: null, vehicleTypeId: null, fitted: false });
  assert.deepEqual([overridden.listPriceKurus, overridden.b2bPriceKurus, overridden.offers[0].informationalPriceKurus], [800000, 800000, 800000]);
  for (const internal of ["auto_price", "fixed_price", "cost_kurus", "888759", "override"]) assert.ok(!JSON.stringify(overridden).includes(internal), internal);
  assert.equal(toPartnerProduct(row(), { offers: [row()], discountBps: 0, imageUrl: null, vehicleTypeId: 9, fitted: false }).exactFitment.status, "NOT_CONFIRMED");
});

test("partner product shows the store brand and part number; partNo stays the supplier code (#602)", () => {
  const edited = row({ display_brand: "SCHAEFFLER", display_code: "510020710" });
  const product = toPartnerProduct(edited, { offers: [edited], discountBps: 0, imageUrl: null, vehicleTypeId: null, fitted: false });
  assert.equal(product.brandName, "SCHAEFFLER");
  assert.deepEqual(product.manufacturerPartNumber, { value: "510020710", normalized: "510020710" });
  assert.equal(product.partNo, "LUK 510 0207 10");
});

test("a hidden supplier OEM field (empty oem) gives no OEM numbers or references; the code still matches (#615)", () => {
  const hidden = row({ oem: "" });
  const product = toPartnerProduct(hidden, { offers: [hidden], discountBps: 0, imageUrl: null, vehicleTypeId: null, fitted: false });
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
});

test("partner catalog reads only saleable rows, never the storefront's unavailable products (#475)", async () => {
  for (const file of await readdir("src/modules/partner")) {
    const source = await readFile(`src/modules/partner/${file}`, "utf8");
    assert.doesNotMatch(source, /storefront_catalog|storefrontCatalogSql|commerce_unavailable_items|getStorefrontProduct/, file);
  }
});
