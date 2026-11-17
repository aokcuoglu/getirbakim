import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { legalDocument, type LegalNode } from "../src/content/legal";
import { faqGroups } from "../src/content/faq";
import { aboutPageJsonLd, articleJsonLd, breadcrumbJsonLd, catalogTrail, collectionJsonLd, faqJsonLd, maxStructuredVehicles, outOfStockLabel, guideTrail, pageTrail, productJsonLd, productOffer, productTrail, returnPolicy,
  serializeJsonLd, unconfirmedStockLabel, type JsonLdNode, type ProductJsonLdInput } from "../src/modules/seo/structured-data";
import { listingPath, makePath } from "../src/modules/seo/paths";
import { productPath } from "../src/modules/seo/product-path";
import { defaultSocialImage, organizationId, siteJsonLd } from "../src/lib/site";

const base = "https://getirbakim.com";
const now = new Date("2026-11-15T10:00:00Z");
const input: ProductJsonLdInput = { path: "/urun/bosch-fren-diski-0986479c20-p1", supplier: "dinamik", name: "Fren Diski", sku: "BOSCH 0986479C20", mpn: "0986479C20", brand: "BOSCH",
  images: ["/api/product-media/a.webp"], priceKurus: 124990, available: true, stockLabel: "Stokta" };
const offers = (node: JsonLdNode | null) => (node as { offers?: Record<string, unknown> }).offers;
const product = (changes: Partial<ProductJsonLdInput>) => productJsonLd({ ...input, ...changes }, base, now);

test("in stock: price, currency, availability, condition, seller and URL", () => {
  const offer = offers(product({}))!;
  assert.equal(offer.price, "1249.90");
  assert.equal(offer.priceCurrency, "TRY");
  assert.equal(offer.availability, "https://schema.org/InStock");
  assert.equal(offer.itemCondition, "https://schema.org/NewCondition");
  assert.deepEqual(offer.seller, { "@type": "Organization", "@id": `${base}/#organization`, name: "Getirbakim", url: base });
  assert.equal(offer.url, `${base}/urun/bosch-fren-diski-0986479c20-p1`);
  assert.equal((product({}) as { url: string }).url, offer.url);
});

test("out of stock only with the page's \"Stokta yok\"", () => {
  const offer = offers(product({ available: false, stockLabel: "Stokta yok" }))!;
  assert.equal(offer.availability, "https://schema.org/OutOfStock");
  assert.equal(offer.price, "1249.90");
});

test("unknown stock gives no offer", () => {
  for (const stockLabel of ["Stok bilgisi güncelleniyor", "Stok bilgisi bulunamadı"]) {
    assert.equal("offers" in product({ available: false, stockLabel })!, false);
  }
});

test("no price, an unsupplied product or a zero price gives no offer", () => {
  assert.equal("offers" in product({ priceKurus: null })!, false);
  assert.equal("offers" in product({ priceKurus: 0 })!, false);
  assert.equal("offers" in product({ unavailable: true })!, false);
  assert.equal(productOffer({ ...input, unavailable: true }, base), null);
});

test("a campaign's end becomes the Istanbul day; an ended or open campaign has none", () => {
  const sale = (sale_until?: string) => ({ price_kind: "sale", list_price_kurus: 150000, ...sale_until ? { sale_until } : {} });
  assert.equal(offers(product({ priceKurus: 99900, pricingSnapshot: sale("2026-11-20T21:30:00Z") }))!.priceValidUntil, "2026-11-21");
  assert.equal(offers(product({ pricingSnapshot: sale("2026-11-14T10:00:00Z") }))!.priceValidUntil, undefined);
  assert.equal(offers(product({ pricingSnapshot: sale() }))!.priceValidUntil, undefined);
  assert.equal(offers(product({ pricingSnapshot: { price_kind: "list", sale_until: "2026-11-20T00:00:00Z" } }))!.priceValidUntil, undefined);
});

test("a service's discounted price never reaches the markup", () => {
  const discounted = (Math.round(124990 * (100 - 20) / 100) / 100).toFixed(2); // catalog.ts servicePrice(124990, 20);
  const json = JSON.stringify(product({}));
  assert.equal(offers(product({}))!.price, "1249.90");
  assert.equal(json.includes(discounted), false);
  assert.equal("account" in input || "discount" in input || "isB2B" in input, false);
});

test("demo products have no markup", () => {
  assert.equal(product({ supplier: "demo" }), null);
});

test("vehicles: unique, capped, in order; none gives no key", () => {
  const models = Array.from({ length: 35 }, (_, index) => `Model ${index % 25}`);
  const vehicles = (product({ vehicleModels: models }) as { isAccessoryOrSparePartFor: { "@type": string; name: string }[] }).isAccessoryOrSparePartFor;
  assert.equal(vehicles.length, maxStructuredVehicles);
  assert.deepEqual(vehicles[0], { "@type": "Vehicle", name: "Model 0" });
  assert.equal(vehicles[19].name, "Model 19");
  assert.equal("isAccessoryOrSparePartFor" in product({ vehicleModels: [] })!, false);
});

test("only filled keys are written; images are absolute", () => {
  const bare = product({ images: [] })!;
  for (const key of ["description", "image", "category", "gtin13"]) assert.equal(key in bare, false);
  const full = product({ description: "Açıklama", category: "Fren sistemi > Fren diski", gtin: { property: "gtin13", value: "4047026000000" } }) as Record<string, unknown>;
  assert.equal(full.description, "Açıklama");
  assert.equal(full.category, "Fren sistemi > Fren diski");
  assert.equal(full.gtin13, "4047026000000");
  assert.deepEqual(full.image, [`${base}/api/product-media/a.webp`]);
});

test("breadcrumb trails and BreadcrumbList", () => {
  const brakes = { name: "Fren diski", slug: "fren-diskleri-269" };
  assert.deepEqual(productTrail({ categories: [brakes], title: "Fren Diski BOSCH 1", path: "/urun/bosch-fren-diski-1-p1" }), [
    { name: "Ana sayfa", path: "/" }, { name: "Katalog", path: "/katalog" },
    { name: "Fren diski", path: "/kategori/fren-diskleri-269" }, { name: "Fren Diski BOSCH 1", path: "/urun/bosch-fren-diski-1-p1" }]);
  assert.deepEqual(catalogTrail({ categories: [] }).map(crumb => crumb.name), ["Ana sayfa", "Katalog"]);
  assert.deepEqual(catalogTrail({ categories: [brakes] }).map(crumb => crumb.path), ["/", "/kategori/fren-diskleri-269"]);
  assert.deepEqual(catalogTrail({ make: { name: "VW", slug: "volkswagen" }, categories: [brakes] }), [
    { name: "Ana sayfa", path: "/" }, { name: "Araç markaları", path: "/arac-markalari" }, { name: "VW", path: "/yedek-parca/volkswagen" },
    { name: "Fren diski", path: "/kategori/fren-diskleri-269/volkswagen" }]);
  assert.deepEqual(catalogTrail({ make: { name: "VW", slug: "volkswagen" }, model: { name: "GOLF 7", slug: "golf-7" }, categories: [] }), [
    { name: "Ana sayfa", path: "/" }, { name: "Araç markaları", path: "/arac-markalari" }, { name: "VW", path: "/yedek-parca/volkswagen" },
    { name: "GOLF 7", path: "/yedek-parca/volkswagen/golf-7" }]);
  assert.deepEqual(catalogTrail({ make: { name: "VW", slug: "volkswagen" }, model: { name: "GOLF 7", slug: "golf-7" }, categories: [brakes] }).at(-1),
    { name: "Fren diski", path: "/kategori/fren-diskleri-269/volkswagen/golf-7" });
  // A model without its make adds nothing.
  assert.deepEqual(catalogTrail({ model: { name: "GOLF 7", slug: "golf-7" }, categories: [] }).map(crumb => crumb.name), ["Ana sayfa", "Katalog"]);
  assert.deepEqual(pageTrail("Hakkımızda", "/bilgi/hakkimizda"), [{ name: "Ana sayfa", path: "/" }, { name: "Hakkımızda", path: "/bilgi/hakkimizda" }]);
  const list = breadcrumbJsonLd(pageTrail("Araç markaları", "/arac-markalari"), base) as { itemListElement: Record<string, unknown>[] };
  assert.deepEqual(list.itemListElement.map(item => [item.position, item.item]), [[1, `${base}/`], [2, `${base}/arac-markalari`]]);
  assert.equal(breadcrumbJsonLd([{ name: "Ana sayfa", path: "/" }], base), null);
});

test("collection page lists the products with their addresses", () => {
  const items = [{ path: productPath({ id: "a", name: "A", name_overridden: false, display_brand: "BOSCH", display_code: "1" }), name: "A" }, { path: productPath({ id: "b", name: "B", name_overridden: false, display_brand: "BOSCH", display_code: "2" }), name: "B" }];
  const node = collectionJsonLd({ name: "Fren diski", path: "/kategori/x", items }, base) as { url: string; mainEntity: { numberOfItems: number; itemListElement: Record<string, unknown>[] } };
  assert.equal(node.url, `${base}/kategori/x`);
  assert.equal(node.mainEntity.numberOfItems, 2);
  assert.deepEqual(node.mainEntity.itemListElement.map(item => [item.position, item.url]), [[1, `${base}${items[0].path}`], [2, `${base}${items[1].path}`]]);
});

test("serialization cannot close the script tag", () => {
  const node = { name: "</script><script>alert(1)</script>" };
  const text = serializeJsonLd(node);
  assert.equal(text.includes("<"), false);
  assert.deepEqual(JSON.parse(text), node);
});

function plain(node: LegalNode): string {
  return typeof node === "string" ? node : node.children.map(plain).join("");
}

test("the return policy constant matches the legal text", () => {
  const text = legalDocument("teslimat-ve-iade")!.sections.flatMap(section => section.blocks.map(plain)).join(" ").replace(/\s+/g, " ");
  assert.equal(returnPolicy.days, 14);
  assert.match(text, /14 gün içinde gerekçe göstermeden/);
  assert.match(text, /iade gideri alınmaz/);
});

test("no rating or review is ever published", () => {
  const json = JSON.stringify([product({}), product({ available: false, stockLabel: "Stokta yok" }), product({ priceKurus: null })]);
  assert.equal(/aggregateRating|"review"/.test(json), false);
});

test("a campaign ending at Istanbul midnight ends on the day before", () => {
  const sale = (sale_until: string) => ({ price_kind: "sale", list_price_kurus: 150000, sale_until });
  assert.equal(offers(product({ pricingSnapshot: sale("2026-11-19T21:00:00Z") }))!.priceValidUntil, "2026-11-19");
  assert.equal(offers(product({ pricingSnapshot: sale("2026-11-19T21:00:01Z") }))!.priceValidUntil, "2026-11-20");
});

const sql = readFileSync(new URL("../db/commerce.sql", import.meta.url), "utf8");

test("the stock labels the markup relies on are the SQL's", () => {
  assert.ok(sql.includes(`'${outOfStockLabel}'`));
  assert.ok(sql.includes(`'${unconfirmedStockLabel}'`));
});

// Every label of commerce_catalog's stock_label (the store's own row and the supplier CASE) with its `available`.
const stockCases: [label: string, available: boolean, expected: string | null][] = [
  ["Stokta mevcut: 5 adet", true, "InStock"],
  [unconfirmedStockLabel, true, null],
  ["Stok bilgisi güncelleniyor", false, null],
  ["Stok bilgisi bulunamadı", false, null],
  ["Tedarikçide mevcut", true, "InStock"],
  ["Diğer depoda mevcut", true, "InStock"],
  ["Tedarikçiye sevkiyat bekleniyor", false, null],
  [outOfStockLabel, false, "OutOfStock"],
];

test("every stock label is in the SQL and maps to InStock, OutOfStock or no offer", () => {
  for (const [label, available, expected] of stockCases) {
    if (!label.startsWith("Stokta mevcut:")) assert.ok(sql.includes(`'${label}'`), label);
    const offer = offers(product({ available, stockLabel: label }));
    assert.equal(offer ? String(offer.availability).split("/").pop() : null, expected, `${label} / ${available}`);
  }
});

test("the seller is the site's Organization", () => {
  const organization = siteJsonLd["@graph"].find(node => node["@type"] === "Organization");
  assert.equal((offers(product({}))!.seller as { "@id": string })["@id"], organization?.["@id"]);
  assert.equal(organization?.["@id"], organizationId);
});

test("listing and product addresses", () => {
  assert.equal(listingPath(), "/katalog");
  assert.equal(listingPath({ categorySlug: "x" }), "/kategori/x");
  assert.equal(listingPath({ makeSlug: "vw" }), makePath("vw"));
  assert.equal(listingPath({ makeSlug: "vw", categorySlug: "x" }), "/kategori/x/vw");
});

test("article: organization as author and publisher, dates and canonical", () => {
  const node = articleJsonLd({ title: "T", description: "D", path: "/rehber/x", published: "2026-11-17", updated: "2026-11-18" }, base) as Record<string, unknown>;
  assert.equal(node["@type"], "Article");
  assert.equal(node.headline, "T");
  assert.equal(node.datePublished, "2026-11-17");
  assert.equal(node.dateModified, "2026-11-18");
  assert.equal(node.inLanguage, "tr-TR");
  assert.deepEqual(node.mainEntityOfPage, { "@type": "WebPage", "@id": `${base}/rehber/x` });
  const org = { "@type": "Organization", "@id": organizationId, name: "Getirbakim" };
  assert.deepEqual(node.author, org);
  assert.deepEqual(node.publisher, org);
  assert.equal(node.image, `${base}${defaultSocialImage.url}`);
});

test("guide trail: home, guides, article", () => {
  assert.deepEqual(guideTrail().map(crumb => crumb.path), ["/", "/rehber"]);
  assert.deepEqual(guideTrail({ title: "T", slug: "x" }).map(crumb => crumb.path), ["/", "/rehber", "/rehber/x"]);
});

test("FAQ: one question per item with the visible answer text; none gives null", () => {
  assert.equal(faqJsonLd([]), null);
  const items = faqGroups.flatMap(group => group.items);
  const node = faqJsonLd(items) as { "@type": string; mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
  assert.equal(node["@type"], "FAQPage");
  assert.equal(node.mainEntity.length, items.length);
  node.mainEntity.forEach((question, index) => {
    assert.equal(question.name, items[index].question);
    assert.equal(question.acceptedAnswer.text, items[index].answer);
  });
});

test("FAQ questions are unique and answers are plain text", () => {
  const items = faqGroups.flatMap(group => group.items);
  assert.equal(new Set(items.map(item => item.question)).size, items.length);
  for (const item of items) assert.ok(!item.answer.includes("<"), item.question);
});

test("about page references the organization instead of reprinting it", () => {
  const node = aboutPageJsonLd("/bilgi/hakkimizda", base) as Record<string, unknown>;
  assert.equal(node["@type"], "AboutPage");
  assert.equal(node.url, `${base}/bilgi/hakkimizda`);
  assert.deepEqual(node.mainEntity, { "@id": organizationId });
});
