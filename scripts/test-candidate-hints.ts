import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { productCostTrySql } from "../src/modules/admin/product-matching-sql";

// The buying cost behind the suffix candidates' price hint (#899), in a throwaway schema.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
before(async () => { schema = await isolatedSchema("candidate_hints_test"); });
after(async () => { await schema?.drop(); });

const rates = (rate: number) => JSON.stringify({ dovizListesi: [{ dovizCinsi: "EUR", satis: rate }] });
let seq = 0;

async function importRun(supplier: string, company: string, rate: number, completedAt: string) {
  await schema.pool.query(
    `INSERT INTO supplier_imports (supplier,company,list_group,warehouse,started_at,completed_at,observations,quality,groups_data,currencies_data,status)
     VALUES ($1,$2,'g','w',$3,$3,'{}','{}','[]',$4::jsonb,'succeeded')`, [supplier, company, completedAt, rates(rate)]);
}

async function product(items: { supplier: string; currency: string | null; nf: number }[]) {
  const id = (await schema.pool.query<{ id: string }>(
    `INSERT INTO products (brand,part_number,brand_label,code) VALUES ('B',$1,'B',$1) RETURNING id`, [`P${++seq}`])).rows[0].id;
  for (const item of items) {
    const productData = item.currency === null ? {} : { dc: item.currency };
    const itemId = (await schema.pool.query<{ id: string }>(
      `INSERT INTO supplier_items (supplier,company,list_group,warehouse,code,product_data,price_data,product_count,price_count,stock_count,first_seen_at,last_seen_at,changed_at)
       VALUES ($1,'c','g','w',$2,$3::jsonb,$4::jsonb,1,1,0,now(),now(),now()) RETURNING id`,
      [item.supplier, `I${++seq}`, JSON.stringify(productData), JSON.stringify({ nf: item.nf })])).rows[0].id;
    await schema.pool.query("INSERT INTO product_sources (supplier_item_id,product_id) VALUES ($1,$2)", [itemId, id]);
  }
  return id;
}

test("productCostTrySql converts by the latest rate, keeps TL, skips unusable rows and takes the lowest cost", async () => {
  await importRun("basbug", "c", 30, "2026-01-01T00:00:00Z"); // older run, replaced by the newer one
  await importRun("basbug", "c", 40, "2026-02-01T00:00:00Z");
  const eur = await product([{ supplier: "basbug", currency: "EUR", nf: 10 }]);
  const tl = await product([{ supplier: "dinamik", currency: null, nf: 25 }]);
  const tlLabel = await product([{ supplier: "dinamik", currency: "TL", nf: 7 }]);
  const zero = await product([{ supplier: "dinamik", currency: "TL", nf: 0 }]);
  const noRate = await product([{ supplier: "dinamik", currency: "USD", nf: 5 }]);
  const lowest = await product([{ supplier: "basbug", currency: "EUR", nf: 10 }, { supplier: "dinamik", currency: "TL", nf: 50 }, { supplier: "dinamik", currency: "USD", nf: 1 }]);
  const unsourced = (await schema.pool.query<{ id: string }>(`INSERT INTO products (brand,part_number,brand_label,code) VALUES ('B','NOSRC','B','NOSRC') RETURNING id`)).rows[0].id;

  const { rows } = await schema.pool.query<{ product_id: string; cost_try: string }>(productCostTrySql, [[eur, tl, tlLabel, zero, noRate, lowest, unsourced]]);
  const cost = new Map(rows.map(row => [row.product_id, Number(row.cost_try)]));
  assert.equal(cost.get(eur), 400, "EUR 10 x latest rate 40");
  assert.equal(cost.get(tl), 25, "blank currency is TRY");
  assert.equal(cost.get(tlLabel), 7, "TL is TRY");
  assert.equal(cost.has(zero), false, "nf<=0 is skipped");
  assert.equal(cost.has(noRate), false, "a currency without a rate is skipped");
  assert.equal(cost.get(lowest), 50, "lowest of 400 and 50; the rate-less USD row is skipped");
  assert.equal(cost.has(unsourced), false, "no source, no row");
});
