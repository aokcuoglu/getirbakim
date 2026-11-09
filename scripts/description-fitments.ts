// Model-level fitment from Dinamik's product descriptions (#392).
//   derive [--dry-run]  rebuilds product_model_fitments for products without an engine-level enrichment
//   report              counts what is stored, per brand
// A product whose shared enrichment lists vehicles, or is complete, is skipped: TecDoc data always wins, and a complete
// enrichment without vehicles means the part is not vehicle-specific.
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { createDescriptionMatcher, type DescriptionCatalogModel } from "../src/modules/store/description-fitment";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const command = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

async function derive() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!(await client.query("SELECT pg_try_advisory_xact_lock(20261106,1) AS locked")).rows[0].locked) throw new Error("Another derive is running");
    await client.query(await readFile("db/product-fitments.sql", "utf8"));
    const catalog = (await client.query<DescriptionCatalogModel>(`SELECT m.id,b.name AS brand,m.name,
      extract(year FROM m.date_from)::int AS "from",extract(year FROM m.date_to)::int AS "to"
      FROM vehicle_models m JOIN vehicle_brands b ON b.id=m.brand_id`)).rows;
    const match = createDescriptionMatcher(catalog);
    const items = (await client.query<{ id: string; brand: string; make: string; text: string }>(`SELECT s.id,
      COALESCE(NULLIF(s.product_data->>'uk',''),'') AS brand,COALESCE(s.product_data->>'kull1s','') AS make,
      COALESCE(NULLIF(s.product_data->>'ac',''),s.product_data->>'stokAdi','') AS text
      FROM supplier_items s WHERE s.supplier='dinamik' AND s.presence='present'
       AND COALESCE(NULLIF(s.product_data->>'ac',''),s.product_data->>'stokAdi','')<>''
       AND NOT EXISTS(SELECT 1 FROM product_enrichment_shared e WHERE e.supplier_item_id=s.id
        AND (e.status='complete' OR jsonb_array_length(COALESCE(e.payload->'vehicles','[]'::jsonb))>0))`)).rows;
    const rows: { supplier_item_id: string; model_id: number; year_from: number | null; year_to: number | null; source_text: string }[] = [];
    const statuses = new Map<string, number>(), brands = new Map<string, { items: number; matched: number }>();
    for (const item of items) {
      const result = match(item.make, item.text);
      statuses.set(result.status, (statuses.get(result.status) ?? 0) + 1);
      const brand = brands.get(item.brand) ?? { items: 0, matched: 0 };
      brand.items++;
      if (result.status === "matched") {
        brand.matched++;
        for (const model of result.models) rows.push({ supplier_item_id: item.id, model_id: model.id, year_from: model.yearFrom, year_to: model.yearTo, source_text: item.text });
      }
      brands.set(item.brand, brand);
    }
    if (!dryRun) {
      await client.query("DELETE FROM product_model_fitments");
      for (let at = 0; at < rows.length; at += 5000) await client.query(`INSERT INTO product_model_fitments(supplier_item_id,model_id,year_from,year_to,source_text)
        SELECT supplier_item_id,model_id,year_from,year_to,source_text FROM jsonb_to_recordset($1::jsonb)
        AS r(supplier_item_id uuid,model_id integer,year_from integer,year_to integer,source_text text)`, [JSON.stringify(rows.slice(at, at + 5000))]);
    }
    await client.query(dryRun ? "ROLLBACK" : "COMMIT");
    const top = [...brands].filter(([, b]) => b.matched).sort((a, b) => b[1].matched - a[1].matched).slice(0, 25)
      .map(([brand, b]) => ({ brand, items: b.items, matched: b.matched, pct: Math.round(100 * b.matched / b.items) }));
    console.log(JSON.stringify({ dryRun, items: items.length, statuses: Object.fromEntries(statuses), rows: rows.length, top }, null, 1));
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function report() {
  console.log(JSON.stringify((await pool.query(`SELECT COALESCE(s.product_data->>'uk','') AS brand,count(DISTINCT f.supplier_item_id)::int AS products,
    count(*)::int AS models FROM product_model_fitments f JOIN supplier_items s ON s.id=f.supplier_item_id GROUP BY 1 ORDER BY 2 DESC LIMIT 40`)).rows, null, 1));
}

try {
  if (command === "derive") await derive();
  else if (command === "report") await report();
  else throw new Error("Usage: description-fitments.ts derive [--dry-run] | report");
} finally { await pool.end(); }
