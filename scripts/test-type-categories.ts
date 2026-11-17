import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import type { SourceCategory } from "../src/modules/enrichment/source-categories";
import {
  acceptedPairs, backfillTypeCategories, brandSlug, categoriesForType, learnTypeCategories, loadTypeCategories, loadTypeCategoriesOrEmpty, releaseTypeCategories, relearnTypeCategories,
  trodoSlugType, trodoType, typeDictionary, typeSlug,
} from "../src/modules/enrichment/type-categories";
import { parts2worldTypedEnrichments, pendingArticleTypes, saveArticleType } from "../src/modules/enrichment/parts2world-types";
import { productUrl } from "../src/modules/enrichment/parts2world-adapter";

// Part type -> Trodo category dictionary (#851): slug helpers, thresholds and lookups in memory; learning from Trodo
// products and the backfill in an isolated copy of the schema.
const category = (id: number): SourceCategory => ({ source: "trodo", id, name: `C${id}`, path: [{ id, name: `C${id}` }] });
const dictionary = (entries: Record<string, number[]>) => typeDictionary(new Map(Object.entries(entries).map(([type, ids]) => [type, ids.map(category)])));
const ids = (categories: SourceCategory[]) => categories.map(c => c.id);

test("type and brand slugs fold punctuation, diacritics, & and +", () => {
  assert.equal(typeSlug("Shaft Seal, differential"), "shaft-seal-differential");
  assert.equal(typeSlug("Control/Trailing Arm, wheel suspension"), "control-trailing-arm-wheel-suspension");
  assert.equal(typeSlug("  V-ribbed Belt "), "v-ribbed-belt");
  assert.equal(brandSlug("MEAT & DORIA"), "meat-and-doria");
  assert.equal(brandSlug("HERTH+BUSS JAKOPARTS"), "herth-plus-buss-jakoparts");
  assert.equal(brandSlug("LEMFÖRDER"), "lemforder");
  assert.equal(brandSlug("A.B.S."), "a-b-s");
});

test("Trodo names and URL slugs give the part type before the brand", () => {
  assert.equal(trodoType("Sensor, coolant temperature AUTLOG AS2078", "AUTLOG"), "Sensor, coolant temperature");
  assert.equal(trodoType("Brake Disc BREMSI CD7697V", "BREMSI"), "Brake Disc");
  assert.equal(trodoType("Brake Disc BREMSIX CD7697V", "BREMSI"), null);
  assert.equal(trodoType("Oil Filter MANN", "MANN"), "Oil Filter");
  assert.equal(trodoType("Oil Filter", "MANN"), null);
  assert.equal(trodoSlugType("condenser-air-conditioning-nrf-35492", "NRF"), "condenser-air-conditioning");
  assert.equal(trodoSlugType("oil-filter-meat-and-doria-15001", "MEAT & DORIA"), "oil-filter");
  assert.equal(trodoSlugType("nrf-35492", "NRF"), null);
});

test("learning counts support per type; thresholds pick share and support", () => {
  const pairs = learnTypeCategories([
    ...Array.from({ length: 4 }, () => ({ type: "brake-disc", categoryIds: [10, 11] })),
    { type: "brake-disc", categoryIds: [10, 12] },
    { type: "oil-filter", categoryIds: [20, 20] },
    { type: "", categoryIds: [1] },
    { type: "wiper", categoryIds: [] },
  ]);
  assert.deepEqual(pairs, [
    { type: "brake-disc", categoryId: 10, support: 5, total: 5 },
    { type: "brake-disc", categoryId: 11, support: 4, total: 5 },
    { type: "brake-disc", categoryId: 12, support: 1, total: 5 },
    { type: "oil-filter", categoryId: 20, support: 1, total: 1 },
  ]);
  const accepted = (minShare: number, minSupport: number) => acceptedPairs(pairs, { minShare, minSupport }).map(p => `${p.type}:${p.categoryId}`);
  // 4/5 = 0.8 passes 0.8 and 0.79, not 0.81; a type keeps every category above the threshold.
  assert.deepEqual(accepted(0.8, 2), ["brake-disc:10", "brake-disc:11"]);
  assert.deepEqual(accepted(0.79, 2), ["brake-disc:10", "brake-disc:11"]);
  assert.deepEqual(accepted(0.81, 2), ["brake-disc:10"]);
  assert.deepEqual(accepted(0.8, 1), ["brake-disc:10", "brake-disc:11", "oil-filter:20"]);
});

test("lookups: exact, numeric tail, conservative plural folding, never a suffix", () => {
  const dict = dictionary({
    "brake-disc": [1, 2], "air-filter": [3], "v-ribbed-belt": [4], "timing-belt-set": [5], headlight: [6], battery: [7],
    "glass-headlight": [8], chassis: [9], "spring-gas": [10], "clutch-box": [11],
  });
  assert.deepEqual(ids(categoriesForType(dict, "brake-disc")), [1, 2]);
  assert.deepEqual(ids(categoriesForType(dict, "air-filter-1")), [3]);
  assert.deepEqual(ids(categoriesForType(dict, "brake-discs")), [1, 2]);
  assert.deepEqual(ids(categoriesForType(dict, "v-ribbed-belts")), [4]);
  assert.deepEqual(ids(categoriesForType(dict, "batteries")), [7]);
  assert.deepEqual(ids(categoriesForType(dict, "clutch-boxes")), [11]);
  assert.deepEqual(ids(categoriesForType(dict, "brake-discs-2")), [1, 2]);
  assert.deepEqual(ids(categoriesForType(dict, "glass-headlights")), [8]);
  assert.deepEqual(ids(categoriesForType(dict, "chassis")), [9]);
  assert.deepEqual(ids(categoriesForType(dict, "spring-gas")), [10]);
  // Words ending in s as singulars are not stripped.
  const singulars = dictionary({ glas: [12], chassi: [13], "headlight-len": [14], "spring-ga": [15] });
  for (const type of ["glass", "chassis", "headlight-lens", "spring-gas"]) assert.deepEqual(categoriesForType(singulars, type), [], type);
  // No suffix or substring matches.
  assert.deepEqual(categoriesForType(dict, "water-pump-and-timing-belt-set"), []);
  assert.deepEqual(categoriesForType(dict, "bulb-headlight"), []);
  assert.deepEqual(categoriesForType(dict, "unknown"), []);
  assert.deepEqual(categoriesForType(dict, null), []);
  assert.deepEqual(categoriesForType(dict, "1"), []);
  // Two types folding together with different categories are ambiguous; the exact types still map.
  const ambiguous = dictionary({ battery: [1], batterys: [2], "lamp-battery": [3], "lamp-batterys": [3] });
  assert.deepEqual(ids(categoriesForType(ambiguous, "battery")), [1]);
  assert.deepEqual(ids(categoriesForType(ambiguous, "batterys")), [2]);
  assert.deepEqual(categoriesForType(ambiguous, "batteries"), []);
  assert.deepEqual(ids(categoriesForType(ambiguous, "lamp-batteries")), [3]);
});

const skip = !process.env.DATABASE_URL && "DATABASE_URL not set";
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
const [basbug] = storefrontCompanies();
const items: string[] = [];

before(async () => {
  if (skip) return;
  schema = await isolatedSchema("type_categories_test");
  for (const code of ["A1", "A2", "A3", "A4", "A5"]) items.push((await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,
    product_data,price_data,stock_data,product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('basbug',$1,'G','MRK',$2,'{"uk":"FEBI","ac":"PARCA","ac2":"","dc":"TL"}','{"nf":100}','{"stok":2}',1,1,1,false,'present',now(),now(),now())
    RETURNING id::text`, [basbug, code])).rows[0].id);
  await schema.pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw) VALUES
    ('trodo',3,NULL,'Car parts','car-parts','{3}','https://example.invalid/3','{}'),
    ('trodo',10,3,'Brake discs','brake-discs','{3,10}','https://example.invalid/10','{}'),
    ('trodo',20,3,'Oil filters','oil-filters','{3,20}','https://example.invalid/20','{}')`);
});
after(async () => { await schema?.drop(); });

const cache = (slug: string, name: string, brand: string, categoryIds: number[]) => schema.pool.query(`INSERT INTO enrichment_source_cache(host,path,body,expires_at)
  VALUES('www.trodo.com',$1,$2,now()+interval '1 day')`, [`/rest/V1/catalog-product-api/product-url/${slug}/IE`,
  JSON.stringify([{ id: "1", attributes: { name, manufacturer: brand, label: { brand: { name: brand } }, category_ids: categoryIds,
    category: categoryIds.map(id => ({ category_id: id, name: `C${id}` })) } }])]);
const enrichment = (item: string, url: string, manufacturer: string, payload: object) => schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,
  supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload,imported_at) VALUES($1,'X','FEBI',$2,'test',$3,'1',$4,now()-interval '1 day')`,
  [item, url, manufacturer, JSON.stringify(payload)]);

test("PostgreSQL: learning from Trodo products drops unknown categories; the backfill writes changes once", { skip }, async () => {
  await cache("brake-disc-febi-1", "Brake Disc FEBI BILSTEIN 1", "FEBI BILSTEIN", [10, 999]);
  await cache("brake-disc-febi-2", "Brake Disc FEBI BILSTEIN 2", "FEBI BILSTEIN", [10]);
  await cache("bulb-jpn-1", "Bulb JPN W21", "JPN", []);
  // A stored Trodo enrichment of a product the cache does not hold counts too.
  await enrichment(items[3], "https://www.trodo.com/oil-filter-mann-filter-w712", "MANN-FILTER", { categories: [category(20)] });
  await cache("oil-filter-bosch-1", "Oil Filter BOSCH 1", "BOSCH", [20]);

  const learned = await relearnTypeCategories(schema.pool);
  assert.deepEqual(learned, { types: 2, pairs: 2, observations: 4, products: 5, skippedNoType: 0, skippedNoCategory: 1, skippedUnknownCategory: 1 });
  assert.deepEqual((await schema.pool.query("SELECT type,category_id,support,total FROM product_type_categories ORDER BY type")).rows,
    [{ type: "brake-disc", category_id: 10, support: 2, total: 2 }, { type: "oil-filter", category_id: 20, support: 2, total: 2 }]);
  // Relearning replaces the dictionary.
  assert.deepEqual(await relearnTypeCategories(schema.pool), learned);

  const dict = await loadTypeCategories(schema.pool);
  assert.deepEqual(categoriesForType(dict, "brake-discs"), [{ source: "trodo", id: 10, name: "Brake discs", path: [{ id: 3, name: "Car parts" }, { id: 10, name: "Brake discs" }] }]);
  assert.equal((await loadTypeCategories(schema.pool, { minSupport: 3 })).exact.size, 0);

  const urls = ["https://spareto.com/products/febi-bilstein-brake-disc/1", "https://spareto.com/products/febi-bilstein-wiper/2", "https://spareto.com/products/febi-bilstein-brake-disc/3"];
  await enrichment(items[0], urls[0], "FEBI BILSTEIN", { specifications: [] });
  await enrichment(items[1], urls[1], "FEBI BILSTEIN", { specifications: [] });
  await enrichment(items[2], urls[2], "FEBI BILSTEIN", { specifications: [] });
  // The worker named this product's categories from its page; its URL names no type the backfill can strip.
  const fromPage = [{ source: "trodo", id: 10, name: "Brake discs", path: [{ id: 3, name: "Car parts" }, { id: 10, name: "Brake discs" }] }];
  await enrichment(items[4], "https://spareto.com/products/ab-s-brake-disc/4", "A.B.S.", { categories: fromPage });
  await schema.pool.query("INSERT INTO product_source_categories(supplier_item_id,source,category_id) VALUES($1,'trodo',10)", [items[4]]);
  const rows = [
    { supplierItemId: items[0], sourceUrl: urls[0], type: "brake-disc" },
    { supplierItemId: items[1], sourceUrl: urls[1], type: "wiper" },
    // The enrichment was re-collected from another URL meanwhile: not touched.
    { supplierItemId: items[2], sourceUrl: "https://spareto.com/products/febi-bilstein-brake-disc/old", type: "brake-disc" },
    { supplierItemId: items[4], sourceUrl: "https://spareto.com/products/ab-s-brake-disc/4", type: null },
  ];
  const state = async (item: string) => (await schema.pool.query<{ categories: unknown; fresh: boolean; links: number[] }>(`SELECT payload->'categories' AS categories,
    imported_at>now()-interval '1 hour' AS fresh,ARRAY(SELECT category_id FROM product_source_categories WHERE supplier_item_id=$1 ORDER BY 1) AS links
    FROM product_enrichments WHERE supplier_item_id=$1`, [item])).rows[0];

  const dry = await backfillTypeCategories(schema.pool, rows, dict, { dryRun: true });
  assert.deepEqual(dry, { rows: 4, mapped: 2, changed: 1, unchanged: 1, missing: 1, noType: 1, unmappedTypes: [{ type: "wiper", count: 1 }] });
  assert.equal((await state(items[0])).fresh, false);

  const first = await backfillTypeCategories(schema.pool, rows, dict);
  assert.deepEqual(first, dry);
  const written = await state(items[0]);
  assert.equal(written.fresh, true);
  assert.deepEqual(written.links, [10]);
  assert.deepEqual(written.categories, categoriesForType(dict, "brake-disc"));
  assert.deepEqual(await state(items[1]), { categories: null, fresh: false, links: [] });
  assert.deepEqual(await state(items[2]), { categories: null, fresh: false, links: [] });
  assert.deepEqual(await state(items[4]), { categories: fromPage, fresh: false, links: [10] });

  await schema.pool.query("UPDATE product_enrichments SET imported_at=now()-interval '1 day' WHERE supplier_item_id=$1", [items[0]]);
  const second = await backfillTypeCategories(schema.pool, rows, dict);
  assert.equal(second.changed, 0);
  assert.equal(second.unchanged, 2);
  assert.equal((await state(items[0])).fresh, false);
  assert.deepEqual((await state(items[0])).links, [10]);
  assert.deepEqual(await state(items[4]), { categories: fromPage, fresh: false, links: [10] });
});

test("PostgreSQL: parts2world part types (#852) are fetched once per article and backfilled when the article still matches", { skip }, async () => {
  // The dictionary of the test above (brake-disc -> 10, oil-filter -> 20).
  const dict = await loadTypeCategories(schema.pool);
  const p2w: string[] = [];
  for (const code of ["P1", "P2", "P3", "P4"]) p2w.push((await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,
    product_data,price_data,stock_data,product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('basbug',$1,'G','MRK',$2,'{"uk":"FEBI","ac":"PARCA","ac2":"","dc":"TL"}','{"nf":100}','{"stok":2}',1,1,1,false,'present',now(),now(),now())
    RETURNING id::text`, [basbug, code])).rows[0].id);
  const write = (item: string, url: string, manufacturer: string, part: string) => schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,
    supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload,imported_at) VALUES($1,'X','FEBI',$2,'test',$3,$4,'{"specifications":[]}',now()-interval '1 day')`,
    [item, url, manufacturer, part]);
  // Two rows share article 100/101 (through different vehicle types): one job, the lower type, both rows counted.
  const shared = [productUrl({ articleId: 100, linkId: 101, vehicleTypeId: 7 }), productUrl({ articleId: 100, linkId: 101, vehicleTypeId: 5 })];
  const other = productUrl({ articleId: 200, linkId: 201, vehicleTypeId: 9 }), none = productUrl({ articleId: 300, linkId: 300, vehicleTypeId: 9 });
  await write(p2w[0], shared[0], "FEBI BILSTEIN", "171209");
  await write(p2w[1], shared[1], "FEBI BILSTEIN", "171209");
  await write(p2w[2], other, "MANN-FILTER", "W 712");
  await write(p2w[3], none, "BOSCH", "1");

  const pending = await pendingArticleTypes(schema.pool);
  assert.equal(pending.length, 3);
  assert.deepEqual(pending.find(p => p.articleId === 100), { articleId: 100, linkId: 101, vehicleTypeId: 5, rows: 2 });

  // Upsert: a second answer replaces the first.
  await saveArticleType(schema.pool, { articleId: 100, linkId: 101, brand: "FEBI BILSTEIN", partNumber: "171209", spareInfo: "Wiper" });
  await saveArticleType(schema.pool, { articleId: 100, linkId: 101, brand: "FEBI BILSTEIN", partNumber: "171209", spareInfo: "Brake Disc" });
  // The live answer names another part than the stored enrichment: no type.
  await saveArticleType(schema.pool, { articleId: 200, linkId: 201, brand: "MANN-FILTER", partNumber: "W 713", spareInfo: "Oil Filter" });
  // No article for these ids.
  await saveArticleType(schema.pool, { articleId: 300, linkId: 300, brand: null, partNumber: null, spareInfo: null });
  assert.equal((await schema.pool.query("SELECT count(*)::int AS n FROM parts2world_article_types")).rows[0].n, 3);
  // A later answer without a name keeps the stored name with its brand and part number.
  await saveArticleType(schema.pool, { articleId: 100, linkId: 101, brand: null, partNumber: null, spareInfo: null });
  assert.deepEqual((await schema.pool.query("SELECT brand,part_number,spare_info FROM parts2world_article_types WHERE article_id=100")).rows,
    [{ brand: "FEBI BILSTEIN", part_number: "171209", spare_info: "Brake Disc" }]);
  assert.deepEqual(await pendingArticleTypes(schema.pool), []);
  assert.deepEqual((await pendingArticleTypes(schema.pool, { retry: true })).map(p => p.articleId), [300]);

  const typed = await parts2worldTypedEnrichments(schema.pool);
  const byItem = new Map(typed.map(t => [t.supplierItemId, t]));
  assert.equal(typed.length, 4);
  assert.deepEqual(byItem.get(p2w[0]), { supplierItemId: p2w[0], sourceUrl: shared[0], type: "brake-disc" });
  assert.equal(byItem.get(p2w[1])?.type, "brake-disc");
  assert.equal(byItem.get(p2w[2])?.type, null);
  assert.equal(byItem.get(p2w[3])?.type, null);

  const result = await backfillTypeCategories(schema.pool, typed, dict);
  assert.deepEqual(result, { rows: 4, mapped: 2, changed: 2, unchanged: 0, missing: 0, noType: 2, unmappedTypes: [] });
  const state = async (item: string) => (await schema.pool.query<{ categories: unknown; links: number[] }>(`SELECT payload->'categories' AS categories,
    ARRAY(SELECT category_id FROM product_source_categories WHERE supplier_item_id=$1 ORDER BY 1) AS links FROM product_enrichments WHERE supplier_item_id=$1`, [item])).rows[0];
  assert.deepEqual(await state(p2w[0]), { categories: categoriesForType(dict, "brake-disc"), links: [10] });
  assert.deepEqual(await state(p2w[1]), { categories: categoriesForType(dict, "brake-disc"), links: [10] });
  assert.deepEqual(await state(p2w[2]), { categories: null, links: [] });
  assert.deepEqual(await state(p2w[3]), { categories: null, links: [] });
});

test("PostgreSQL: a hold backfill keeps imported_at; release moves it for the source's categorised rows only", { skip }, async () => {
  const added: string[] = [];
  for (const code of ["H1", "H2", "H3", "H4"]) added.push((await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,
    product_data,price_data,stock_data,product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('basbug',$1,'G','MRK',$2,'{"uk":"FEBI","ac":"PARCA","ac2":"","dc":"TL"}','{"nf":100}','{"stok":2}',1,1,1,false,'present',now(),now(),now())
    RETURNING id::text`, [basbug, code])).rows[0].id);
  const [held, bare, other, trodo] = added;
  // Earlier tests left categorised rows of both sources; the release counts them too.
  const before = async (like: string) => (await schema.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM product_enrichments WHERE source_url LIKE $1
    AND jsonb_typeof(payload->'categories')='array' AND payload->'categories'<>'[]'::jsonb`, [like])).rows[0].n;
  const sparetoBefore = await before("https://spareto.com/%"), p2wBefore = await before("https://www.parts2world.com/%");
  const sparetoUrl = (n: number) => `https://spareto.com/products/febi-bilstein-brake-disc/${n}`;
  const otherUrl = "https://www.parts2world.com/tecdoc/#/product?mod=1&link=2&id=3";
  const trodoUrl = "https://www.trodo.com/brake-disc-febi-9";
  await enrichment(held, sparetoUrl(11), "FEBI BILSTEIN", { specifications: [] });
  await enrichment(bare, sparetoUrl(12), "FEBI BILSTEIN", { specifications: [] });
  await enrichment(other, otherUrl, "FEBI BILSTEIN", { categories: [category(10)] });
  await enrichment(trodo, trodoUrl, "FEBI BILSTEIN", { categories: [category(10)] });
  const dict = dictionary({ "brake-disc": [10] });
  const rows = [{ supplierItemId: held, sourceUrl: sparetoUrl(11), type: "brake-disc" }];
  const state = async (item: string) => (await schema.pool.query<{ categories: unknown; fresh: boolean; links: number[] }>(`SELECT payload->'categories' AS categories,
    imported_at>now()-interval '1 hour' AS fresh,ARRAY(SELECT category_id FROM product_source_categories WHERE supplier_item_id=$1 ORDER BY 1) AS links
    FROM product_enrichments WHERE supplier_item_id=$1`, [item])).rows[0];

  const written = await backfillTypeCategories(schema.pool, rows, dict, { hold: true });
  assert.equal(written.changed, 1);
  assert.deepEqual(await state(held), { categories: categoriesForType(dict, "brake-disc"), fresh: false, links: [10] });

  const dry = await releaseTypeCategories(schema.pool, { sources: ["spareto"], dryRun: true });
  assert.deepEqual(dry, [{ source: "spareto", rows: sparetoBefore + 1 }]);
  assert.equal((await state(held)).fresh, false);

  assert.deepEqual(await releaseTypeCategories(schema.pool, { sources: ["spareto"] }), [{ source: "spareto", rows: sparetoBefore + 1 }]);
  assert.equal((await state(held)).fresh, true);
  // Uncategorised rows of the source and other sources' rows keep their imported_at.
  for (const item of [bare, other, trodo]) assert.equal((await state(item)).fresh, false);

  assert.deepEqual(await releaseTypeCategories(schema.pool, { sources: ["parts2world"] }), [{ source: "parts2world", rows: p2wBefore + 1 }]);
  assert.equal((await state(other)).fresh, true);
  assert.equal((await state(trodo)).fresh, false);
});

test("PostgreSQL: a worker's dictionary is empty, not an error, without learned types", { skip }, async () => {
  const client = await schema.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM product_type_categories");
    assert.equal((await loadTypeCategoriesOrEmpty(client)).exact.size, 0);
  } finally { await client.query("ROLLBACK"); client.release(); }
});
