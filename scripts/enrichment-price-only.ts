// Dinamik price-list-only codes as a shared enrichment tier for spareto and parts2world (#1075,
// src/modules/enrichment/price-only-queue.ts, docs/product-enrichment.md).
//   enqueue                         gives every present, unlinked price-only row a job with its live code, brand and OEM
//                                   (legacy jobs carry an empty brand); a second run writes nothing. Run
//                                   `enrichment:parts2world -- match` afterwards so parts2world sees the new jobs.
//   enable LABEL... [--note TEXT]   lets spareto search the brands' price-only rows (Dinamik's marka label); a label no
//                                   price-only row carries is refused
//   disable LABEL...                takes the brands out of spareto's price-only queue
//   status                          per enabled brand (and parts2world's other brands): rows, searched, found, enriched,
//                                   listed as cards and remaining, with the next 10 codes per worker
// The workers take their share with --price-only-share F or ENRICHMENT_PRICE_ONLY_SHARE (default 0: off).
import { Pool } from "pg";
import {
  enabledBrandsSql, enqueuePriceOnlySources, priceOnlyArticleQueueSql, priceOnlyChunkSql, priceOnlyOrderSql,
  priceOnlyOtherBrandsStatsSql, priceOnlyStatsSql, type PriceOnlyStats,
} from "../src/modules/enrichment/price-only-queue";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const [command = "status", ...args] = process.argv.slice(2);
const noteAt = args.indexOf("--note");
const note = noteAt >= 0 ? args[noteAt + 1] ?? null : null;
const labels = args.filter((arg, at) => !arg.startsWith("--") && (noteAt < 0 || at !== noteAt + 1));

async function enable() {
  if (!labels.length) throw Error("enable needs at least one brand label");
  const known = new Set((await pool.query<{ label: string }>(`SELECT DISTINCT supplier_item_brand(s.supplier,s.product_data) AS label FROM supplier_items s
    WHERE supplier_item_brand(s.supplier,s.product_data)=ANY($1::text[]) AND s.supplier='dinamik' AND s.stock_data IS NULL AND s.presence='present'
     AND NOT s.conflicting AND NOT EXISTS(SELECT 1 FROM product_sources ps WHERE ps.supplier_item_id=s.id)`, [labels])).rows.map((row) => row.label));
  const unknown = labels.filter((label) => !known.has(label));
  if (unknown.length) throw Error(`No price-only Dinamik row carries ${unknown.join(", ")}; nothing enabled`);
  await pool.query(`INSERT INTO enrichment_price_only_brands(label,note) SELECT unnest($1::text[]),$2
    ON CONFLICT(label) DO UPDATE SET note=COALESCE(EXCLUDED.note,enrichment_price_only_brands.note)`, [labels, note]);
  console.log(JSON.stringify({ enabled: (await pool.query<{ label: string }>(enabledBrandsSql)).rows.map((row) => row.label) }));
}

async function disable() {
  if (!labels.length) throw Error("disable needs at least one brand label");
  const removed = (await pool.query("DELETE FROM enrichment_price_only_brands WHERE label=ANY($1::text[])", [labels])).rowCount ?? 0;
  console.log(JSON.stringify({ disabled: removed, enabled: (await pool.query<{ label: string }>(enabledBrandsSql)).rows.map((row) => row.label) }));
}

async function status() {
  const brands = (await pool.query<PriceOnlyStats>(priceOnlyStatsSql)).rows;
  const others = (await pool.query<PriceOnlyStats>(priceOnlyOtherBrandsStatsSql)).rows;
  const enabled = brands.map((row) => row.label);
  const sparetoIds = enabled.length ? (await pool.query<{ id: string }>(priceOnlyOrderSql, [10, enabled])).rows.map((row) => row.id) : [];
  const spareto = (await pool.query<{ code: string }>(priceOnlyChunkSql, [sparetoIds])).rows;
  const next = async (descending: boolean) => (await pool.query<{ code: string }>(`${priceOnlyArticleQueueSql(descending)} LIMIT 10`)).rows;
  // Dinamik's codes start with the brand label already.
  const label = (row: { code: string }) => row.code;
  console.log(JSON.stringify({
    brands: [...brands, ...others],
    next: { spareto: spareto.map(label), parts2world: (await next(false)).map(label), parts2worldProxy: (await next(true)).map(label) },
  }, null, 1));
}

try {
  if (command === "enqueue") console.log(JSON.stringify({ written: await enqueuePriceOnlySources(pool) }));
  else if (command === "enable") await enable();
  else if (command === "disable") await disable();
  else if (command === "status") await status();
  else throw Error("Usage: enrichment-price-only.ts enqueue|enable LABEL... [--note TEXT]|disable LABEL...|status");
} finally { await pool.end(); }
