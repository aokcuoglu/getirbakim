import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { enrichmentImportSchema } from "../src/modules/store/enrichment-contract";
import { importEnrichments } from "../src/modules/enrichment/import";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const command = process.argv[2];
try {
  if (command === "prepare") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(20261003,2)");
      await client.query(await readFile("db/product-enrichment.sql", "utf8"));
      await client.query(await readFile("db/product-fitments.sql", "utf8"));
      await client.query(await readFile("db/manufacturer-logos.sql", "utf8"));
      await client.query(await readFile("db/enrichment-worker.sql", "utf8"));
      await client.query(await readFile("db/source-categories.sql", "utf8"));
      const result = await client.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,oem)
        SELECT id,code,COALESCE(product_data->>'uk',''),COALESCE(product_data->>'oe','') FROM supplier_items
        ON CONFLICT(supplier_item_id) DO NOTHING`);
      await client.query("COMMIT");
      console.log(JSON.stringify({ queued: result.rowCount }));
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } else if (command === "import") {
    const inputFile = process.argv[3];
    if (!inputFile) throw new Error("Usage: enrichment:import -- path/to/import.json");
    const contents = JSON.parse(await readFile(inputFile, "utf8"));
    const entries = Array.isArray(contents) ? contents : [contents];
    // Validate the whole file before importing any entry.
    const items = entries.map(entry => enrichmentImportSchema.parse(entry));
    await importEnrichments(pool, items);
  } else if (command === "status") {
    console.log(JSON.stringify((await pool.query("SELECT status,count(*)::int AS count FROM product_enrichment_jobs GROUP BY status ORDER BY status")).rows, null, 2));
    console.log(JSON.stringify((await pool.query("SELECT count(*)::int AS files,COALESCE(sum(size_bytes),0)::bigint AS bytes FROM product_media_objects")).rows[0]));
    console.log(JSON.stringify((await pool.query("SELECT * FROM product_enrichment_sources ORDER BY host")).rows));
  } else if (command === "probe") {
    // A source block stops the batch; it must never become a 'not found' result.
    const source = "https://www.trodo.com/headlight-depo-445-1134rmldem2";
    const response = await fetch(source, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Getirbakim-Enrichment/1.0" } });
    const body = await response.text();
    const blocked = [401,403,429,503].includes(response.status) || /cf-chl-|checking your browser|security verification|<title>[^<]*(?:attention required|just a moment)/i.test(body);
    await pool.query(`INSERT INTO product_enrichment_sources(host,probe_url,http_status,status) VALUES($1,$2,$3,$4)
      ON CONFLICT(host) DO UPDATE SET probe_url=EXCLUDED.probe_url,http_status=EXCLUDED.http_status,status=EXCLUDED.status,checked_at=now()`,
      [new URL(source).hostname,source,response.status,blocked ? "blocked" : response.ok ? "accessible" : "error"]);
    console.log(JSON.stringify({ source, httpStatus: response.status, result: blocked ? "source_blocked" : response.ok ? "accessible_parser_not_yet_verified" : "source_error", pendingJobsUnchanged: true }));
    if (blocked || !response.ok) process.exitCode = 2;
  } else { throw new Error("Expected prepare, import, status or probe"); }
} finally { await pool.end(); }
