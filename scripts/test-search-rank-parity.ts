import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import type { CatalogQuery } from "../src/modules/store/catalog-query";

// Rank parity (#1448) in an isolated copy of the schema: a plain search ranks its hits through summarizeSearch (rows read by
// primary key), a filtered one through catalogRank over the catalog view. They are separate expressions that must stay in
// step, so the same hit set is ranked both ways (the filter keeps every row: all shown brands) and must give the same ids
// in the same order, for supplier rows, store products, admin-edited rows, hidden-OEM rows, unavailable rows and rank ties.
// The filtered side reads live (SEARCH_RANK_ORDER=0), so the rank expressions are compared, not the cached order. Fixed
// expected orders guard against both expressions changing together. Nothing is written to the shared database's tables.
type Catalog = typeof import("../src/modules/store/catalog");
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let catalog: Catalog;
let closeDb: () => Promise<void>;
let brands: string[];
const ids: Record<string, string> = {};
const keyOf = new Map<string, string>();
const [basbug] = storefrontCompanies();

let workStorage: typeof import("next/dist/server/app-render/work-async-storage.external").workAsyncStorage;
const inRequest = <T>(run: () => Promise<T>) => workStorage.run({ route: "/test", forceStatic: true } as Parameters<typeof workStorage.run>[0], run);

// Fixed ids: rank ties fall to the id, so the fixed orders below need ids that do not change from run to run.
let nextId = 0;
const fixedId = () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`;

type Row = { name: string; brand?: string; code: string; oem?: string; description?: string; ageMinutes?: number; presence?: string };
async function supplierRow(key: string, row: Row) {
  const product = { uk: row.brand ?? "BOSCH", ac: row.name, ac2: row.description ?? "", dc: "TL", ...(row.oem ? { oe: row.oem } : {}) };
  const { rows: [created] } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(id,supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,presence,first_seen_at,last_seen_at,changed_at)
    VALUES($6,'basbug',$1,'G','MRK',$2,$3,'{"nf":100}','{"stok":2}',1,1,1,$4,now()-interval '30 days',now(),$5) RETURNING id::text`,
  [basbug, row.code, product, row.presence ?? "present", new Date(Date.UTC(2026, 10, 20) - (row.ageMinutes ?? 0) * 60_000), fixedId()]);
  ids[key] = created.id;
  keyOf.set(created.id, key);
}
async function storeRow(key: string, name: string, code: string, brand: string, description = "") {
  const { rows: [created] } = await schema.pool.query<{ id: string }>(`INSERT INTO store_products(id,supplier,code,name,brand,description,price_kurus,stock,updated_at)
    VALUES($6,'demo',$1,$2,$3,$4,10000,5,$5) RETURNING id::text`, [code, name, brand, description, new Date(Date.UTC(2026, 10, 19)), fixedId()]);
  ids[key] = created.id;
  keyOf.set(created.id, key);
}
const override = (key: string, column: "name" | "description" | "part_number" | "hide_oem", value: string | boolean) =>
  schema.pool.query(`INSERT INTO commerce_item_overrides(supplier_item_id,product_id,${column}) VALUES($1,$1,$2)
    ON CONFLICT (supplier_item_id) DO UPDATE SET ${column}=$2`, [ids[key], value]);

before(async () => {
  schema = await isolatedSchema("search_rank_parity_test");
  for (const name of ["BOSCH", "TRW", "FEBI"]) {
    const { rows: [brand] } = await schema.pool.query<{ id: string }>("INSERT INTO brands(key,name) VALUES($1,$1) RETURNING id::text", [name]);
    await schema.pool.query("INSERT INTO supplier_brands(supplier,label,brand_id,items) VALUES('basbug',$1,$2,10)", [name, brand.id]);
  }
  await supplierRow("exact", { name: "FREN BALATASI", code: "BOS A100", ageMinutes: 5 });
  await supplierRow("longer", { name: "FREN BALATASI ON TAKIM SERAMIK", brand: "TRW", code: "TRW A200", ageMinutes: 6 });
  await supplierRow("disc", { name: "FREN DISKI", brand: "TRW", code: "TRW A300", description: "balatasi ile uyumlu", ageMinutes: 7 });
  await supplierRow("weak", { name: "YAG FILTRESI", brand: "FEBI", code: "FEB A400", description: "fren sistemi icin degil", ageMinutes: 8 });
  await supplierRow("renamed", { name: "YAG FILTRESI", brand: "FEBI", code: "FEB R500", ageMinutes: 9 });
  await supplierRow("described", { name: "HAVA FILTRESI", brand: "FEBI", code: "FEB D600", ageMinutes: 10 });
  await supplierRow("recoded", { name: "FREN HORTUMU ON", code: "BOS C700", ageMinutes: 11 });
  await supplierRow("hiddenOem", { name: "SILECEK", code: "BOS H800", oem: "FREN BALATASI 7788", ageMinutes: 12 });
  await supplierRow("shownOem", { name: "SILECEK", code: "BOS H801", oem: "FREN BALATASI 7788", ageMinutes: 13 });
  await supplierRow("gone", { name: "FREN BALATASI", code: "BOS G900", presence: "inactive", ageMinutes: 14 });
  // Rank ties: the same name and age, so the id tie-break decides.
  for (const n of [1, 2, 3]) await supplierRow(`tie${n}`, { name: "FREN HORTUMU", brand: "FEBI", code: `FEB T${n}00`, ageMinutes: 20 });
  await storeRow("storeSet", "FREN BALATASI SETI", "STR 1", "BOSCH");
  await storeRow("storeFluid", "FREN SIVISI DOT 4", "STR 2", "TRW", "fren balatasi sistemi icin");
  await schema.pool.query("SELECT refresh_product_matches()");
  await override("renamed", "name", "FREN BALATASI OZEL SERI");
  await override("described", "description", "fren balatasi ile uyumlu");
  await override("recoded", "part_number", "FRN 5555");
  await override("hiddenOem", "hide_oem", true);
  await schema.pool.query("INSERT INTO search_vocabulary(scope,word,frequency) VALUES('product','fren',100),('product','balatasi',100),('product','hortumu',50)");
  Object.assign(globalThis, { AsyncLocalStorage });
  workStorage = (await import("next/dist/server/app-render/work-async-storage.external")).workAsyncStorage;
  const [{ db }, catalogModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/catalog")]);
  catalog = catalogModule;
  closeDb = () => db.end();
  brands = (await schema.pool.query<{ brand: string }>("SELECT DISTINCT display_brand AS brand FROM storefront_catalog_entries")).rows.map(row => row.brand);
});
after(async () => { await closeDb?.(); await schema?.drop(); });

const browse = (query: CatalogQuery) => inRequest(() => catalog.browseProducts(query, {}));
const key = (id: string) => keyOf.get(id) ?? id;
/** The ids of a search ranked by summarizeSearch (plain) and by catalogRank (every shown brand as the filter, live), as fixture keys. */
async function rankedBoth(q: string, searchBy?: "code") {
  const plain = await browse({ q, searchBy });
  const filtered = await withLiveRank(() => browse({ q, searchBy, brands: JSON.stringify(brands) }));
  return { plain: plain.items.map(item => key(item.id)), filtered: filtered.items.map(item => key(item.id)), plainTotal: plain.total, filteredTotal: filtered.total };
}
async function withLiveRank<T>(run: () => Promise<T>) {
  const saved = { price: process.env.SEARCH_PRICE_ORDER, rank: process.env.SEARCH_RANK_ORDER };
  process.env.SEARCH_PRICE_ORDER = "0";
  process.env.SEARCH_RANK_ORDER = "0";
  try { return await run(); } finally {
    for (const [name, value] of [["SEARCH_PRICE_ORDER", saved.price], ["SEARCH_RANK_ORDER", saved.rank]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}

// Fixed orders for the fixture: guard against both expressions changing together (change one only after reading why the order moved).
const cases: [string, { q: string; searchBy?: "code" }, string[]][] = [
  ["one word", { q: "fren" }, ["storeFluid", "exact", "longer", "disc", "renamed", "recoded", "tie1", "tie2", "tie3", "storeSet", "weak", "described", "shownOem", "gone"]],
  ["two words", { q: "fren balatasi" }, ["exact", "longer", "renamed", "storeSet", "storeFluid", "disc", "described", "shownOem", "gone"]],
  ["three words", { q: "fren balatasi seramik" }, ["longer"]],
  ["admin-edited description", { q: "balatasi uyumlu" }, ["disc", "described"]],
  ["hidden OEM", { q: "7788" }, ["shownOem"]],
  ["code", { q: "BOS A100", searchBy: "code" }, ["exact"]],
  ["edited part number", { q: "FRN5555", searchBy: "code" }, ["recoded"]],
  ["code prefix", { q: "FEB", searchBy: "code" }, ["weak", "renamed", "described", "tie1", "tie2", "tie3"]],
  ["ties", { q: "hortumu" }, ["recoded", "tie1", "tie2", "tie3"]],
  ["misspelt, corrected", { q: "frenx balatasi" }, ["exact", "longer", "renamed", "storeSet", "storeFluid", "disc", "described", "shownOem", "gone"]],
  ["store products", { q: "sivisi" }, ["storeFluid"]],
];

test("plain and filtered searches rank the same hit set in the same order", async () => {
  for (const [label, search, expected] of cases) {
    const { plain, filtered, plainTotal, filteredTotal } = await rankedBoth(search.q, search.searchBy);
    assert.equal(plainTotal, filteredTotal, `${label}: hit count`);
    assert.deepEqual(filtered, plain, `${label}: plain (summarizeSearch) and filtered (catalogRank) orders differ`);
    assert.deepEqual(plain, expected, `${label}: fixed order`);
  }
});
