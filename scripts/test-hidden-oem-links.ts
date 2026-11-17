import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// A supplier OEM field hidden on a product (#615) stops feeding OEM-derived equivalents (#631), in an isolated copy of
// the schema: product_hidden_oem_drop on save and merge carry, refresh_product_matches() afterwards. Manual links,
// decisions, the product's own ORIJINAL key and Dinamik barcode OEM numbers stay.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let overrides: typeof import("../src/modules/admin/product-override-store");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const [basbug, seta, dinamik] = storefrontCompanies();
let admin: string;

const X = "9673689380", Y = "1K0615301AA", Q = "7701208266", Z = "6020030303", W = "4410020011";
const V = "5520030044", U = "3310040055", R1 = "2210050066", R2 = "1110060077";
type Supplier = "basbug" | "dinamik" | "seta";
async function item(key: string, supplier: Supplier, code: string, product: Record<string, unknown>) {
  const company = supplier === "basbug" ? basbug : supplier === "seta" ? seta : dinamik;
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES($1,$2,'G',$3,$4,$5,'{"nf":100}','{"stok":2}',1,1,1,false,'present',now()-interval '10 days',now()-interval '1 hour',now()-interval '1 hour') RETURNING id::text`,
  [supplier, company, supplier === "basbug" ? "MRK" : "ALL", code, { dc: "TL", ac2: "", ...product }]);
  ids[key] = rows[0].id;
}
const basbugItem = (key: string, code: string, brand: string, oe?: string) => item(key, "basbug", code, { uk: brand, ac: `${brand} PARCA`, ...(oe ? { oe } : {}) });
const productOf = async (key: string) => (await schema.pool.query<{ product_id: string }>(
  "SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0].product_id;
const refresh = () => schema.pool.query("SELECT refresh_product_matches()");
const setOemHidden = async (key: string, hidden: boolean) => {
  const result = await overrides.persistProductOverride(schema.pool, await productOf(key), { hide_supplier_oem: hidden }, admin);
  assert.ok(result.ok);
};
/** The pair's link in both directions ([kind, brand, part_number] or null each). */
async function link(a: string, b: string) {
  const [pa, pb] = [await productOf(a), await productOf(b)];
  const one = async (from: string, to: string) => {
    const row = (await schema.pool.query<{ kind: string; brand: string; part_number: string }>(
      "SELECT kind,brand,part_number FROM product_equivalents WHERE product_id=$1 AND equivalent_id=$2", [from, to])).rows[0];
    return row ? [row.kind, row.brand, row.part_number] : null;
  };
  return [await one(pa, pb), await one(pb, pa)];
}
const oemLink = (part: string) => [["oem", "ORIJINAL", part], ["oem", "ORIJINAL", part]];
const none = [null, null];
const oemRefs = async (key: string) => (await schema.pool.query<{ part_number: string }>(
  "SELECT part_number FROM product_references WHERE supplier_item_id=$1 AND kind='oem' ORDER BY part_number", [ids[key]])).rows.map(row => row.part_number);
const setaRefs = async (key: string) => (await schema.pool.query<{ part_number: string }>(
  "SELECT part_number FROM product_seta_references WHERE item_id=$1 AND seta_item_id=$2", [ids[key], ids.seta])).rows.map(row => row.part_number);
const setaRefsOf = async (setaKey: string) => (await schema.pool.query<{ n: number }>(
  "SELECT count(*)::int AS n FROM product_seta_references WHERE seta_item_id=$1", [ids[setaKey]])).rows[0].n;
async function decide(a: string, b: string, status: "equivalent" | "unrelated") {
  const [pa, pb] = [await productOf(a), await productOf(b)].sort();
  await schema.pool.query("INSERT INTO product_equivalent_decisions(product_a,product_b,status,decided_by) VALUES($1,$2,$3,$4)", [pa, pb, status, admin]);
}

before(async () => {
  schema = await isolatedSchema("hidden_oem_links_test");
  admin = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved)
    VALUES('Test Yönetici',$1,'x','admin',true) RETURNING id::text`, [`${randomUUID()}@example.com`])).rows[0].id;
  // Two Başbuğ products and a SETA row stating X, the original part owning X (and stating Q).
  await basbugItem("a", "BOS 10010001", "BOSCH", X);
  await basbugItem("b", "VAL 20020002", "VALEO", X);
  await basbugItem("orig", X, "OE-PSA", Q);
  await item("seta", "seta", "SET 30030003", { uk: "SETA", ac: "SETA PARCA", oems: [X] });
  // A's Dinamik row: its barcode states Y, which E states as OEM.
  await item("aDinamik", "dinamik", "BOSCH 10010001", { marka: "BOSCH", stokAdi: "BOSCH PARCA", barkod1: Y });
  await basbugItem("e", "MEY 50050005", "MEYLE", Y);
  // Manual equivalent of A; F states X but is decided unrelated to A; J states the original's alternative number Q.
  await basbugItem("c", "MAH 40040004", "MAHLE");
  await basbugItem("f", "FIL 60060006", "FILTRON", X);
  await basbugItem("j", "SWA 70070007", "SWAG", Q);
  // Merge fixture: H and I share W; K is a product without OEM links.
  await basbugItem("h", "FEB 80080008", "FEBI", W);
  await basbugItem("i", "LEM 90090009", "LEMFORDER", W);
  await basbugItem("k", "TRW 11011011", "TRW");
  // Decided pairs also tied by an OEM number: a manual equivalent (M1–M2) and a brand pair (KYB–MONROE).
  await basbugItem("m1", "DEL 13013013", "DELPHI", V);
  await basbugItem("m2", "NIS 14014014", "NISSENS", V);
  await basbugItem("kyb", "KYB 15015015", "KYB", U);
  await basbugItem("monroe", "MON 15015015", "MONROE", U);
  await schema.pool.query("INSERT INTO product_brand_pair_decisions(brand_a,brand_b,status) VALUES('KYB','MONROE','equivalent')");
  // Merge into a hidden target: N (stating R2, shared with P) joins T.
  await basbugItem("t", "BRE 16016016", "BREMBO", R1);
  await basbugItem("n", "TEX 17017017", "TEXTAR", R2);
  await basbugItem("p", "ATE 18018018", "ATE", R2);
  await refresh();
  await decide("a", "c", "equivalent");
  await decide("a", "f", "unrelated");
  await decide("m1", "m2", "equivalent");
  await refresh();
  const [{ db }, overridesModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/admin/product-override-store")]);
  overrides = overridesModule;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("a refresh links products through a stated OEM number", async () => {
  assert.deepEqual(await link("a", "b"), oemLink(X));
  assert.deepEqual(await link("a", "orig"), oemLink(X));
  assert.deepEqual(await link("a", "seta"), oemLink(X));
  assert.deepEqual(await link("a", "e"), oemLink(Y));
  assert.deepEqual((await link("a", "c")).map(row => row?.[0]), ["manual", "manual"]);
  assert.deepEqual(await link("a", "f"), none, "an unrelated decision");
  assert.deepEqual(await setaRefs("a"), [X]);
  assert.deepEqual(await oemRefs("a"), [X]);
  assert.deepEqual(await oemRefs("aDinamik"), [Y]);
});

async function assertHiddenA() {
  assert.deepEqual(await oemRefs("a"), []);
  assert.deepEqual(await setaRefs("a"), []);
  for (const other of ["b", "orig", "seta"]) assert.deepEqual(await link("a", other), none, other);
  // Kept: other products' links through X, the Dinamik barcode OEM, the manual link.
  assert.deepEqual(await link("b", "orig"), oemLink(X));
  assert.deepEqual(await link("b", "seta"), oemLink(X));
  assert.deepEqual(await setaRefs("b"), [X]);
  assert.deepEqual(await link("a", "e"), oemLink(Y));
  assert.deepEqual(await oemRefs("aDinamik"), [Y]);
  assert.deepEqual((await link("a", "c")).map(row => row?.[0]), ["manual", "manual"]);
}

test("hiding the supplier OEM drops its links at once", async () => {
  await setOemHidden("a", true);
  await assertHiddenA();
});

test("a refresh keeps the hidden number out", async () => {
  await refresh();
  await assertHiddenA();
});

test("a row joining the hidden product in a refresh brings no OEM links", async () => {
  await basbugItem("g", "GAT 12012012", "GATES", Z);
  await item("aNew", "basbug", "BSH 10010001", { uk: "BOSCH", ac: "BOSCH PARCA YENI", oe: Z });
  await refresh();
  assert.equal(await productOf("aNew"), await productOf("a"));
  assert.deepEqual(await oemRefs("aNew"), []);
  assert.deepEqual(await link("a", "g"), none);
  await assertHiddenA();
});

test("shown again, the links return with the next refresh; decisions still apply", async () => {
  await setOemHidden("a", false);
  assert.deepEqual(await link("a", "b"), none, "only the matcher brings them back");
  await refresh();
  assert.deepEqual(await link("a", "b"), oemLink(X));
  assert.deepEqual(await link("a", "orig"), oemLink(X));
  assert.deepEqual(await link("a", "seta"), oemLink(X));
  assert.deepEqual(await link("a", "g"), oemLink(Z));
  assert.deepEqual(await setaRefs("a"), [X]);
  assert.deepEqual(await link("a", "f"), none, "the unrelated decision stays");
  assert.deepEqual((await link("a", "c")).map(row => row?.[0]), ["manual", "manual"]);
});

test("a merge carrying the hidden flag drops the target's OEM links", async () => {
  assert.deepEqual(await link("h", "i"), oemLink(W));
  await setOemHidden("k", true);
  const [source, target] = [await productOf("k"), await productOf("h")];
  const { carried } = (await schema.pool.query<{ carried: { fields: string[] } }>(
    "WITH merged AS (SELECT product_merge($1,$2,$3) AS id) SELECT product_overrides_carry($1, id, $3) AS carried FROM merged", [source, target, admin])).rows[0];
  assert.ok(carried.fields.includes("hide_supplier_oem"));
  assert.deepEqual(await link("h", "i"), none);
  assert.deepEqual(await oemRefs("h"), []);
  await refresh();
  assert.deepEqual(await link("h", "i"), none);
});

test("an original part hiding its OEM field keeps the links of its own number", async () => {
  assert.deepEqual(await link("orig", "j"), oemLink(Q));
  await setOemHidden("orig", true);
  assert.deepEqual(await link("orig", "j"), none);
  assert.deepEqual(await link("orig", "b"), oemLink(X));
  assert.deepEqual(await link("orig", "a"), oemLink(X));
  await refresh();
  assert.deepEqual(await link("orig", "j"), none);
  assert.deepEqual(await link("orig", "b"), oemLink(X));
  await setOemHidden("orig", false);
  await refresh();
});

test("a SETA product hiding its OEM field drops the SETA references to it", async () => {
  assert.ok(await setaRefsOf("seta") > 0);
  await setOemHidden("seta", true);
  assert.equal(await setaRefsOf("seta"), 0);
  assert.deepEqual(await oemRefs("seta"), []);
  for (const other of ["a", "b"]) assert.deepEqual(await link("seta", other), none, other);
  assert.deepEqual(await link("a", "b"), oemLink(X));
  await refresh();
  assert.equal(await setaRefsOf("seta"), 0);
  assert.deepEqual(await link("seta", "b"), none);
});

test("a pair an admin decided keeps its link without the OEM number", async () => {
  assert.deepEqual(await link("m1", "m2"), oemLink(V));
  assert.deepEqual(await link("kyb", "monroe"), oemLink(U));
  await setOemHidden("m1", true);
  await setOemHidden("kyb", true);
  assert.deepEqual((await link("m1", "m2")).map(row => row?.[0]), ["manual", "manual"]);
  assert.deepEqual(await link("kyb", "monroe"), [["brand", "MONROE", "15015015"], ["brand", "KYB", "15015015"]]);
  await refresh();
  assert.deepEqual((await link("m1", "m2")).map(row => row?.[0]), ["manual", "manual"]);
  assert.deepEqual((await link("kyb", "monroe")).map(row => row?.[0]), ["brand", "brand"]);
});

test("rows merged into a product with a hidden OEM field lose their OEM links", async () => {
  assert.deepEqual(await link("n", "p"), oemLink(R2));
  await setOemHidden("t", true);
  const [source, target] = [await productOf("n"), await productOf("t")];
  const { carried } = (await schema.pool.query<{ carried: { fields: string[] } }>(
    "WITH merged AS (SELECT product_merge($1,$2,$3) AS id) SELECT product_overrides_carry($1, id, $3) AS carried FROM merged", [source, target, admin])).rows[0];
  assert.deepEqual(carried.fields, []);
  assert.equal(await productOf("n"), target);
  assert.deepEqual(await oemRefs("n"), []);
  assert.deepEqual(await link("t", "p"), none);
  await refresh();
  assert.deepEqual(await link("t", "p"), none);
});
