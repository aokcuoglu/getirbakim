import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { writeDescriptionFitments, type DescriptionFitmentRow } from "../src/modules/store/description-fitment-sync";

// The description fitment derivation syncs product_model_fitments (#798): unchanged rows are not rewritten and keep
// derived_at (the sitemap's lastmod), a model or year change moves it, a source_text change alone updates the text only.

describe("description fitment sync", { skip: !process.env.DATABASE_URL }, () => {
  let schema: Awaited<ReturnType<typeof isolatedSchema>>;
  const ids: Record<string, string> = {};
  const EPOCH = "2026-01-01T00:00:00.000Z";

  async function item(key: string) {
    ids[key] = (await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
      VALUES('dinamik','DINAMIK','G','MRK',$1,'{"uk":"TST","ac":"TEST","ac2":"","dc":"TL"}','{"nf":100}','{"stok":2}',1,1,1,false,'present',now(),now(),now())
      RETURNING id::text`, [`TST ${key}`])).rows[0].id;
  }
  async function write(rows: DescriptionFitmentRow[]) {
    const client = await schema.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await writeDescriptionFitments(client, rows);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  type Stored = { key: string; year_from: number | null; year_to: number | null; source_text: string; derived_at: string; xmin: string };
  async function stored() {
    const rows = (await schema.pool.query<Omit<Stored, "key"> & { supplier_item_id: string; model_id: number }>(`SELECT supplier_item_id::text,model_id,
      year_from,year_to,source_text,to_char(derived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS derived_at,xmin::text AS xmin
      FROM product_model_fitments`)).rows;
    const keys = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    return new Map(rows.map(row => [`${keys[row.supplier_item_id]}:${row.model_id}`, row]));
  }
  const row = (key: string, model: number, year_from: number | null, year_to: number | null, source_text = `TEXT ${key}`): DescriptionFitmentRow =>
    ({ supplier_item_id: ids[key], model_id: model, year_from, year_to, source_text });

  before(async () => {
    schema = await isolatedSchema("descfit");
    await schema.pool.query("INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VW','VOLKSWAGEN')");
    await schema.pool.query("INSERT INTO vehicle_models(id,brand_id,name) VALUES(10,1,'GOLF IV'),(11,1,'PASSAT')");
    for (const key of ["A", "A2", "B", "B2", "B3", "C", "D", "E", "F", "G"]) await item(key);
  });
  after(async () => { await schema?.drop(); });

  const first = () => [row("A", 10, null, null), row("A2", 10, 2000, 2004), row("B", 10, 2000, 2004), row("B2", 10, null, null),
    row("B3", 10, 1998, 2003), row("C", 10, 2001, null), row("E", 11, 1997, 2005)];
  const second = () => [row("A", 10, null, null), row("A2", 10, 2000, 2004), row("B", 10, 2001, 2004), row("B2", 10, 1999, null),
    row("B3", 10, 1998, null), row("D", 11, null, 2010), row("E", 11, 1997, 2005, "TEXT E CHANGED")];

  // Each test starts from an empty table, so any of them runs alone under --test-name-pattern.
  test("only changed rows are written and derived_at moves only with the model or years", async () => {
    await write([]);
    assert.deepEqual(await write(first()), { inserted: 7, updated: 0, deleted: 0, unchanged: 0 });
    await schema.pool.query("UPDATE product_model_fitments SET derived_at=$1", [EPOCH]);
    const before = await stored();

    assert.deepEqual(await write(second()), { inserted: 1, updated: 4, deleted: 1, unchanged: 2 });
    const after = await stored();
    assert.deepEqual(new Set(after.keys()), new Set(["A:10", "A2:10", "B:10", "B2:10", "B3:10", "D:11", "E:11"]));
    for (const key of ["A:10", "A2:10"]) {
      assert.equal(after.get(key)?.derived_at, EPOCH, key);
      assert.equal(after.get(key)?.xmin, before.get(key)?.xmin, `${key} is not rewritten`);
    }
    for (const key of ["B:10", "B2:10", "B3:10"]) assert.ok(after.get(key)!.derived_at > EPOCH, `${key} moved`);
    assert.deepEqual([after.get("B:10")?.year_from, after.get("B2:10")?.year_from, after.get("B3:10")?.year_to], [2001, 1999, null]);
    assert.equal(after.get("E:11")?.source_text, "TEXT E CHANGED");
    assert.equal(after.get("E:11")?.derived_at, EPOCH, "a text change alone keeps derived_at");
    assert.ok(after.get("D:11")!.derived_at > EPOCH);
    assert.deepEqual([after.get("D:11")?.year_from, after.get("D:11")?.year_to], [null, 2010]);

    assert.deepEqual(await write(second()), { inserted: 0, updated: 0, deleted: 0, unchanged: 7 });
    const again = await stored();
    for (const [key, value] of after) assert.equal(again.get(key)?.xmin, value.xmin, `${key} is not rewritten by an identical sync`);
  });

  test("dropping one of a product's models moves the derived_at of its remaining rows", async () => {
    await write([]);
    await write([row("F", 10, 2000, 2004), row("F", 11, 2000, 2004), row("G", 10, null, null)]);
    await schema.pool.query("UPDATE product_model_fitments SET derived_at=$1", [EPOCH]);
    const before = await stored();

    assert.deepEqual(await write([row("F", 10, 2000, 2004), row("G", 10, null, null)]), { inserted: 0, updated: 0, deleted: 1, unchanged: 2 });
    const after = await stored();
    assert.deepEqual(new Set(after.keys()), new Set(["F:10", "G:10"]));
    assert.ok(after.get("F:10")!.derived_at > EPOCH, "the product's lastmod still moves");
    assert.equal(after.get("G:10")?.derived_at, EPOCH);
    assert.equal(after.get("G:10")?.xmin, before.get("G:10")?.xmin, "an unrelated product is not rewritten");
  });

  test("two syncs in one transaction work and an empty derivation empties the table", async () => {
    await write([]);
    assert.deepEqual(await write(second()), { inserted: 7, updated: 0, deleted: 0, unchanged: 0 });
    const client = await schema.pool.connect();
    try {
      await client.query("BEGIN");
      assert.deepEqual(await writeDescriptionFitments(client, second()), { inserted: 0, updated: 0, deleted: 0, unchanged: 7 });
      assert.deepEqual(await writeDescriptionFitments(client, []), { inserted: 0, updated: 0, deleted: 7, unchanged: 0 });
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    assert.equal((await schema.pool.query("SELECT 1 FROM product_model_fitments")).rowCount, 0);
  });
});
