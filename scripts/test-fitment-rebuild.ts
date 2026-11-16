import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { parseRebuildArgs, parseRebuildItems } from "./fitment-rebuild-args";
import { FITMENT_MATCHER_VERSION } from "../src/modules/store/fitment-matcher";
import { rebuildProductFitments } from "../src/modules/store/fitment-sync";
import { importBundleEnrichments } from "./storefront-bundle-enrichments";

// The scoped fitment rebuild of the storefront sync (#561): rebuilding the items a bundle wrote plus the rows of an
// older matcher version leaves product_vehicle_fitments exactly as a full rebuild would.

test("rebuild arguments are strict: no arguments rebuild everything, anything unknown is an error", () => {
  assert.deepEqual(parseRebuildArgs([]), { itemsFile: null });
  assert.deepEqual(parseRebuildArgs(["--items=/tmp/items.json"]), { itemsFile: "/tmp/items.json" });
  for (const argv of [["--item=/tmp/x.json"], ["--items"], ["--items="], ["/tmp/x.json"], ["--items=a", "--items=b"], ["--full"]]) {
    assert.throws(() => parseRebuildArgs(argv), /Unknown or repeated argument/, argv.join(" "));
  }
  const id = randomUUID();
  assert.deepEqual(parseRebuildItems(JSON.stringify([id])), [id]);
  assert.deepEqual(parseRebuildItems("[]"), []);
  assert.throws(() => parseRebuildItems(JSON.stringify(["not-a-uuid"])), /JSON array of supplier item uuids/);
  assert.throws(() => parseRebuildItems(JSON.stringify({ items: [id] })), /JSON array of supplier item uuids/);
  assert.throws(() => parseRebuildItems(JSON.stringify([1])), /JSON array of supplier item uuids/);
});

describe("scoped fitment rebuild", { skip: !process.env.DATABASE_URL }, () => {
  let schema: Awaited<ReturnType<typeof isolatedSchema>>;
  const ids: Record<string, string> = {};

  const vehicle = (overrides: Record<string, unknown> = {}) => ({ model: "MERCEDES-BENZ 190 (W201)", engineAndCodes: "2.0 M102", fuel: "Petrol",
    kw: 90, ps: 122, cc: 1997, from: "09/1984", to: "08/1993", ...overrides });
  const matched = vehicle();
  const datesDiffer = vehicle({ from: "01/1985" });
  const modelMissing = vehicle({ model: "OPEL ASTRA G" });
  const ambiguous = vehicle({ model: "TOYOTA COROLLA", engineAndCodes: "1.6", kw: 81, ps: 110, cc: 1598, from: "01/2000", to: "12/2005" });
  const byType = vehicle({ model: "UNKNOWN MODEL", engineAndCodes: "X", typeId: 344 });

  const payload = (vehicles: unknown[]) => JSON.stringify({ specifications: [], vehicles, oemNumbers: {}, crossReferences: {} });
  async function item(key: string) {
    const code = `TST ${key}`;
    ids[key] = (await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
      VALUES('basbug','BASBUG','G','MRK',$1,'{"uk":"TST","ac":"TEST","ac2":"","dc":"TL"}','{"nf":100}','{"stok":2}',1,1,1,false,'present',now(),now(),now())
      RETURNING id::text`, [code])).rows[0].id;
  }
  async function enrich(key: string, vehicles: unknown[]) {
    await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload)
      VALUES($1,$2,'TST','https://example.com/x','test','TST',$2,$3)`, [ids[key], `TST ${key}`, payload(vehicles)]);
  }
  /** Writes a payload the way the bundle import does: without touching the fitments. */
  const setVehicles = (key: string, vehicles: unknown[]) =>
    schema.pool.query("UPDATE product_enrichments SET payload=$2 WHERE supplier_item_id=$1", [ids[key], payload(vehicles)]);
  async function rebuild(items?: string[]) {
    const client = await schema.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await rebuildProductFitments(client, { items });
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  const snapshot = async () => (await schema.pool.query(`SELECT supplier_item_id,source_index,source_vehicle,vehicle_type_id,match_status,candidate_type_ids,matcher_version
    FROM product_vehicle_fitments ORDER BY 1,2`)).rows;
  const matchedAt = async (key: string) => (await schema.pool.query<{ at: string }>(
    "SELECT string_agg(matched_at::text,',' ORDER BY source_index) AS at FROM product_vehicle_fitments WHERE supplier_item_id=$1", [ids[key]])).rows[0].at;
  const queued = async () => (await schema.pool.query<{ kind: string; id: string }>("SELECT kind,id::text FROM product_enrichment_shared_queue ORDER BY 2")).rows;
  const statuses = async (key: string) => (await schema.pool.query<{ match_status: string }>(
    "SELECT match_status FROM product_vehicle_fitments WHERE supplier_item_id=$1 ORDER BY source_index", [ids[key]])).rows.map(row => row.match_status);

  before(async () => {
    schema = await isolatedSchema("fitment_rebuild_test");
    await schema.pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'MERCEDES-BENZ','MERCEDES-BENZ'),(2,'TOYOTA','TOYOTA');
      INSERT INTO vehicle_models(id,brand_id,name) VALUES(10,1,'190 (W201)'),(20,2,'COROLLA');
      INSERT INTO vehicle_types(id,model_id,name,cc,fuel_type,fuel_name,hp,kwt,year_of_constr_from,year_of_constr_to,search_text) VALUES
       (340,10,'2.0',1997,'Petrol','Benzin',122,90,'1984-09-01','1993-08-01','2.0'),
       (344,10,'2.3',2299,'Petrol','Benzin',136,100,'1984-09-01','1993-08-01','2.3'),
       (900,20,'1.6',1598,'Petrol','Benzin',110,81,'2000-01-01','2005-12-01','1.6'),
       (901,20,'1.6',1598,'Petrol','Benzin',110,81,'2000-01-01','2005-12-01','1.6');`);
    for (const key of ["A", "B", "C", "D", "E"]) await item(key);
    await enrich("A", [matched, modelMissing]);
    await enrich("B", [matched, byType]);
    await enrich("D", [matched, ambiguous, byType]);
    await enrich("E", [matched, datesDiffer, byType]);
  });
  after(async () => { await schema?.drop(); });

  test("a full rebuild derives every product's fitments", async () => {
    const result = await rebuild();
    assert.deepEqual({ mode: result.mode, requested: result.requested, outdated: result.outdated, products: result.products },
      { mode: "full", requested: 0, outdated: 0, products: 4 });
    assert.deepEqual(result.counts, { matched: 7, model_missing: 1, ambiguous: 1, dates_differ: 1 });
    assert.deepEqual(await statuses("D"), ["matched", "ambiguous", "matched"]);
    assert.deepEqual(await statuses("E"), ["matched", "dates_differ", "matched"]);
  });

  test("a scoped rebuild of the written items plus outdated rows equals a full rebuild", async () => {
    const dBefore = await matchedAt("D");
    await setVehicles("A", [modelMissing, ambiguous, byType]);
    await setVehicles("B", []);
    await enrich("C", [datesDiffer, matched]);
    // E was built by an older matcher: wrong rows that only a version-aware rebuild repairs; E is not in the list.
    await schema.pool.query(`UPDATE product_vehicle_fitments SET matcher_version='strict-v2',
      match_status=CASE WHEN match_status='matched' THEN 'ambiguous' ELSE match_status END,vehicle_type_id=NULL WHERE supplier_item_id=$1`, [ids.E]);
    await schema.pool.query("TRUNCATE product_enrichment_shared_queue");

    const result = await rebuild([ids.A, ids.B, ids.C, randomUUID()]);
    assert.deepEqual({ mode: result.mode, requested: result.requested, outdated: result.outdated, products: result.products },
      { mode: "scoped", requested: 4, outdated: 1, products: 4 });
    const scoped = await snapshot();
    assert.equal(await matchedAt("D"), dBefore, "an untouched product is not rewritten");
    assert.deepEqual(await statuses("B"), []);
    assert.deepEqual(await statuses("C"), ["dates_differ", "matched"]);
    assert.deepEqual(await statuses("E"), ["matched", "dates_differ", "matched"]);
    assert.equal((await schema.pool.query("SELECT 1 FROM product_vehicle_fitments WHERE matcher_version<>$1", [FITMENT_MATCHER_VERSION])).rowCount, 0);
    const queue = await queued();
    assert.ok(queue.every(row => row.kind === "i"), JSON.stringify(queue));
    assert.deepEqual(new Set(queue.map(row => row.id)), new Set([ids.A, ids.B, ids.C, ids.E]));

    const full = await rebuild();
    assert.equal(full.mode, "full");
    assert.equal(full.products, 5);
    assert.deepEqual(await snapshot(), scoped);
    assert.notEqual(await matchedAt("D"), dBefore, "a full rebuild rewrites every product");
  });

  test("an empty item list with nothing outdated changes nothing", async () => {
    const before = await snapshot();
    await schema.pool.query("TRUNCATE product_enrichment_shared_queue");
    const result = await rebuild([]);
    assert.deepEqual({ mode: result.mode, requested: result.requested, outdated: result.outdated, products: result.products, counts: result.counts },
      { mode: "scoped", requested: 0, outdated: 0, products: 0, counts: {} });
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await queued(), []);
  });

  test("the bundle's enrichment upsert returns a row each time it is applied, unchanged or not", async () => {
    const client = await schema.pool.connect();
    try {
      await client.query("BEGIN");
      const bundleId = randomUUID(), missing = randomUUID();
      await client.query(`CREATE TEMP TABLE bundle_items ON COMMIT DROP AS
        SELECT * FROM (VALUES ($1::uuid,$2::uuid),($3::uuid,NULL::uuid)) t(bundle_id,id)`, [bundleId, ids.D, missing]);
      await client.query("CREATE TEMP TABLE bundle_media(bundle_id uuid,id uuid) ON COMMIT DROP");
      const row = (supplierItemId: string) => ({ supplier_item_id: supplierItemId, supplier_code: "TST D", supplier_brand: "TST", source_url: "https://example.com/x",
        source_method: "test", manufacturer: "TST", manufacturer_part_number: "TST D", image_id: null, payload: JSON.parse(payload([matched])),
        imported_at: "2026-11-01T00:00:00Z", match_basis: { type: "exact_part" } });
      const rows = [row(bundleId), row(missing)];
      assert.deepEqual(await importBundleEnrichments(client, rows), { written: 1, items: [ids.D] });
      assert.deepEqual(await importBundleEnrichments(client, rows), { written: 1, items: [ids.D] }, "a retried, unchanged row is written and returned again");
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
});
