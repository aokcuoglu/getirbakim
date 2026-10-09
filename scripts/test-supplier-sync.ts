import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { applySupplierSnapshot, migrateSupplierSnapshots, pruneSupplierHistory, rejectionReason, type ObservationItem, type SupplierScope } from "../src/modules/suppliers/sync";
import { supplierHealth } from "../src/modules/suppliers/health";
import { importBasbug, BasbugImportError } from "../src/modules/suppliers/basbug-import";

const product = { no: "TEST", ac: "Test", ac2: "", uk: "MARKA", oe: "123", lgk: "FIAT", m: "", mo: "", y: "", b: "ADET", dc: "EUR", lf: 4, mkk: "" };
const scope = { supplier: "basbug" as const, company: "TEST", group: "FIAT", warehouse: "MRK" };
const fixture = (code: string, price = 3): ObservationItem => ({ code, product_data: { ...product, no: code }, price_data: { no: code, nf: price, mif: 4, k: 0 }, stock_data: { no: code, stok: 1, sYol: 0, sDepo: "MRK", sFarkliDepo: 0 }, product_count: 1, price_count: 1, stock_count: 1, conflicting: false, source_variants: {} });

test("quality guards distinguish a normal fluctuation from a suspect full response", () => {
  const old = { uniqueProducts: 100, missingPrices: 0, missingStocks: 0 };
  assert.equal(rejectionReason({ ...old, uniqueProducts: 80 }, old), null);
  assert.match(rejectionReason({ ...old, uniqueProducts: 79 }, old)!, /product-drop/);
  assert.match(rejectionReason({ ...old, missingPrices: 11 }, old)!, /missing-prices/);
  assert.match(rejectionReason({ ...old, missingStocks: 11 }, old)!, /missing-stocks/);
  assert.ok(rejectionReason({ ...old, uniqueProducts: 0 }));
});

test("PostgreSQL: idempotence, changes, disappearance, return, rollback, retention, replay and importer lifecycle", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL required for isolated PostgreSQL integration tests");
  const root = new Pool({ connectionString: process.env.DATABASE_URL });
  const control=await root.connect();
  if (!(await control.query("SELECT pg_try_advisory_lock(20261001,2) AS locked")).rows[0].locked) {
    control.release(); await root.end();
    throw new Error("The live supplier scheduler is running; retry these integration tests when it finishes.");
  }
  const namespace = `supplier_test_${randomBytes(8).toString("hex")}`;
  await control.query(`CREATE SCHEMA ${namespace}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${namespace}` });
  const client = await pool.connect();
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.BASBUG_BASE_URL;
  const envKeys = ["BASBUG_USERNAME", "BASBUG_PASSWORD", "BASBUG_CLIENT_ID", "BASBUG_CLIENT_SECRET"];
  const originalEnv = envKeys.map(key => process.env[key]);
  let tick = 0;
  async function run(items: ObservationItem[], customScope: SupplierScope = scope) {
    await client.query("BEGIN");
    try {
      const at = new Date(Date.now() + tick++ * 1000);
      const id = (await client.query(`INSERT INTO supplier_imports(supplier,company,list_group,warehouse,started_at,completed_at,status,observations,quality,groups_data,currencies_data)
        VALUES($1,$2,$3,$4,$5,$5,'succeeded','{}','{}','{}','{}') RETURNING id`, [customScope.supplier,customScope.company,customScope.group,customScope.warehouse,at])).rows[0].id;
      const stats = await applySupplierSnapshot(client,customScope,id,items,at);
      await client.query("COMMIT");
      return { id, stats };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  }
  try {
    await client.query(await readFile("db/schema.sql", "utf8"));
    const initial = [fixture("A"),fixture("B")];
    assert.equal((await run(initial)).stats.added, 2);
    const first = (await client.query("SELECT * FROM supplier_items WHERE code='A'")).rows[0];
    assert.equal((await run(initial)).stats.unchanged, 2);
    assert.equal(Number((await client.query("SELECT count(*) FROM supplier_items")).rows[0].count), 2);
    assert.equal(Number((await client.query("SELECT count(*) FROM supplier_item_changes")).rows[0].count), 2);
    assert.equal((await client.query("SELECT changed_at FROM supplier_items WHERE code='A'")).rows[0].changed_at.getTime(), first.changed_at.getTime());
    assert.equal((await run([fixture("A",7),fixture("B")])).stats.changed, 1);
    const updated = (await client.query("SELECT * FROM supplier_items WHERE code='A'")).rows[0];
    assert.equal(updated.id,first.id); assert.equal(updated.price_data.nf,7);
    assert.equal((await run([fixture("B")])).stats.missing, 1);
    assert.equal((await client.query("SELECT presence FROM supplier_items WHERE code='A'")).rows[0].presence,"pending_missing");
    assert.equal((await run([fixture("B")])).stats.inactive, 1);
    assert.equal((await run([fixture("B")])).stats.inactive, 0);
    assert.equal((await run(initial)).stats.restored, 1);
    assert.equal((await client.query("SELECT id FROM supplier_items WHERE code='A'")).rows[0].id,first.id);
    const unknown = fixture("A"); unknown.price_data=null; unknown.stock_data=null;
    await run([unknown,fixture("B")]);
    assert.equal((await client.query("SELECT price_data,stock_data FROM supplier_items WHERE code='A'")).rows[0].price_data,null);
    await run([fixture("A")], { ...scope, group: "AV" });
    await run([fixture("A")], { ...scope, warehouse: "IZM" });
    await run([fixture("A")], { ...scope, supplier: "dinamik" });
    assert.equal(Number((await client.query("SELECT count(*) FROM supplier_items")).rows[0].count),5);
    // Stock-only, currency-only and source-quality changes are also auditable; row-count noise is not.
    const stockChanged=fixture("A"); stockChanged.stock_data={ ...stockChanged.stock_data, stok:0 };
    await run([stockChanged,fixture("B")]);
    const currencyChanged={ ...stockChanged,product_data:{ ...stockChanged.product_data,dc:"USD" } };
    assert.equal((await run([currencyChanged,fixture("B")])).stats.changed,1);
    assert.equal((await run([{ ...currencyChanged,product_count:2 },fixture("B")])).stats.unchanged,2);
    const conflict={ ...currencyChanged,conflicting:true,source_variants:{ prices:[{ nf:3 },{ nf:9 }] } };
    assert.equal((await run([conflict,fixture("B")])).stats.changed,1);
    // Restore the null state used below to verify transaction rollback.
    await run([unknown,fixture("B")]);
    const countBefore = (await client.query("SELECT count(*) FROM supplier_item_changes")).rows[0].count;
    await client.query("BEGIN");
    await applySupplierSnapshot(client,scope,(await client.query("SELECT id FROM supplier_imports LIMIT 1")).rows[0].id,[fixture("A",99)],new Date());
    await client.query("ROLLBACK");
    assert.equal((await client.query("SELECT count(*) FROM supplier_item_changes")).rows[0].count,countBefore);
    assert.equal((await client.query("SELECT price_data FROM supplier_items WHERE id=$1",[first.id])).rows[0].price_data,null);
    // Replay two original raw snapshots; only a changed price should generate the second event.
    await client.query("TRUNCATE supplier_items,supplier_item_changes,supplier_imports,supplier_sync_scopes CASCADE");
    for (const price of [3,3,8]) {
      const at = new Date(Date.now() - (3-price)*1000);
      const id = (await client.query(`INSERT INTO supplier_imports(supplier,company,list_group,warehouse,started_at,completed_at,observations,quality,groups_data,currencies_data)
        VALUES('basbug','TEST','FIAT','MRK',$1,$1,'{}','{}','{}','{}') RETURNING id`, [at])).rows[0].id;
      const item=fixture("A",price);
      await client.query(`INSERT INTO supplier_import_items(import_id,code,product_data,price_data,stock_data,product_count,price_count,stock_count)
        VALUES($1,$2,$3,$4,$5,1,1,1)`,[id,item.code,item.product_data,item.price_data,item.stock_data]);
    }
    await client.query("BEGIN"); await migrateSupplierSnapshots(client); await client.query("COMMIT");
    assert.equal(Number((await client.query("SELECT count(*) FROM supplier_items")).rows[0].count),1);
    assert.equal(Number((await client.query("SELECT count(*) FROM supplier_import_items")).rows[0].count),1);
    assert.equal(Number((await client.query("SELECT count(*) FROM supplier_item_changes")).rows[0].count),2);
    await client.query("BEGIN"); await migrateSupplierSnapshots(client); await client.query("COMMIT");
    assert.equal(Number((await client.query("SELECT count(*) FROM supplier_item_changes")).rows[0].count),2);
    // Importer is exercised without contacting suppliers, using a valid five-product full response.
    await client.query("TRUNCATE supplier_items,supplier_item_changes,supplier_imports,supplier_sync_scopes CASCADE");
    process.env.BASBUG_BASE_URL="https://api.basbug.com.tr";
    for (const key of envKeys) process.env[key]="integration-test";
    let codes = ["A","B","C","D","E"];
    let fail=false;
    globalThis.fetch = async input => {
      const url = String(input);
      if (fail) throw new Error("network test failure");
      const body = url.includes("/auth/Login") ? { token:"test-token",tokenTipi:"Bearer",tokenBitisSuresi:300 }
        : url.includes("ListeGrubuGetir") ? { malzemeGruplariListesi:[{ kod:"FIAT",ad:"FIAT" }] }
        : url.includes("MalzemeleriGetir") ? { malzemeListesi:codes.map(code=>fixture(code).product_data) }
        : url.includes("FiyatGetir") ? { fiyatListesi:codes.map(code=>fixture(code).price_data) }
        : url.includes("StokGetir") ? { stokListesi:codes.map(code=>({ ...fixture(code).stock_data, sDepo:new URL(url).searchParams.get("Depo") })) }
        : { dovizListesi:[{ dovizCinsi:"EUR",alis:"40",satis:"41" }] };
      return new Response(JSON.stringify(body), { headers:{ "Content-Type":"application/json" } });
    };
    assert.equal((await importBasbug(pool,{ group:"FIAT",warehouse:"MRK",company:"TEST" })).stats.added,5);
    assert.equal((await importBasbug(pool,{ group:"FIAT",warehouse:"MRK",company:"TEST" })).stats.unchanged,5);
    assert.equal(Number((await client.query("SELECT count(*) FROM supplier_import_items")).rows[0].count),0);
    fail=true;
    await assert.rejects(importBasbug(pool,{ group:"FIAT",warehouse:"MRK",company:"TEST" }),error=>error instanceof BasbugImportError && error.reason === "upstream");
    assert.equal(Number((await client.query("SELECT count(*) FROM supplier_imports WHERE status='failed'")).rows[0].count),1);
    assert.equal(Number((await client.query("SELECT count(*) FROM supplier_items WHERE presence='present'")).rows[0].count),5);
    const successfulFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes("ListeGrubuGetir")) throw new DOMException("sensitive response must not be stored", "TimeoutError");
      return successfulFetch(input, init);
    };
    fail=false;
    await assert.rejects(importBasbug(pool,{ group:"FIAT",warehouse:"MRK",company:"TEST" }),error=>error instanceof BasbugImportError && error.reason === "upstream");
    assert.equal((await client.query("SELECT error_reason FROM supplier_imports ORDER BY started_at DESC LIMIT 1")).rows[0].error_reason,"upstream: ListeGrubuGetir: timeout");
    globalThis.fetch = async (input, init) => String(input).includes("FiyatGetir") ? new Response("sensitive body",{status:503}) : successfulFetch(input, init);
    await assert.rejects(importBasbug(pool,{ group:"FIAT",warehouse:"MRK",company:"TEST" }),error=>error instanceof BasbugImportError && error.reason === "upstream");
    assert.equal((await client.query("SELECT error_reason FROM supplier_imports ORDER BY started_at DESC LIMIT 1")).rows[0].error_reason,"upstream: FiyatGetir: HTTP 503");
    assert.equal(Number((await client.query("SELECT count(*) FROM supplier_items WHERE presence='present'")).rows[0].count),5);
    globalThis.fetch = successfulFetch;
    fail=false; codes=["A"];
    await assert.rejects(importBasbug(pool,{ group:"FIAT",warehouse:"MRK",company:"TEST" }),error=>error instanceof BasbugImportError && error.reason === "rejected");
    assert.equal(Number((await client.query("SELECT count(*) FROM supplier_imports WHERE status='rejected'")).rows[0].count),1);
    assert.equal(Number((await client.query("SELECT count(*) FROM supplier_items WHERE presence='present'")).rows[0].count),5);
    process.env.BASBUG_BASE_URL="http://invalid.example";
    await assert.rejects(importBasbug(pool,{ group:"FIAT",warehouse:"MRK",company:"TEST" }),error=>error instanceof BasbugImportError && error.reason === "config");
    assert.equal(Number((await client.query("SELECT count(*) FROM supplier_imports WHERE error_reason LIKE 'config:%'")).rows[0].count),1);
    process.env.BASBUG_BASE_URL="https://api.basbug.com.tr";
    codes=["A","B","C","D"];
    assert.equal((await importBasbug(pool,{ group:"FIAT",warehouse:"MRK",company:"TEST" })).stats.missing,1);
    assert.equal((await importBasbug(pool,{ group:"FIAT",warehouse:"MRK",company:"TEST" })).stats.inactive,1);
    await client.query("SELECT pg_advisory_lock(20261001,1)");
    try { await assert.rejects(importBasbug(pool,{ group:"FIAT",warehouse:"MRK",company:"TEST" }),error=>error instanceof BasbugImportError && error.reason === "busy"); }
    finally { await client.query("SELECT pg_advisory_unlock(20261001,1)"); }
    // A dead worker is recorded as failed before the next successful fetch.
    await client.query(`INSERT INTO supplier_imports(supplier,company,list_group,warehouse,started_at,status,observations,quality,groups_data,currencies_data)
      VALUES('basbug','TEST','AV','MRK',now(),'running','{}','{}','{}','{}')`);
    await importBasbug(pool,{ group:"FIAT",warehouse:"MRK",company:"TEST" });
    assert.equal((await client.query("SELECT status FROM supplier_imports WHERE list_group='AV'")).rows[0].status,"failed");
    // Commercial observations do not call product/group APIs, discover products or advance missing counters.
    const originalProductObservation=(await client.query("SELECT observations FROM supplier_imports WHERE status='succeeded' AND run_kind='full' ORDER BY completed_at DESC LIMIT 1")).rows[0].observations.MalzemeleriGetir;
    await client.query("UPDATE supplier_items SET presence='pending_missing',missing_count=1 WHERE code='D'");
    const fullDue=(await client.query("SELECT next_run_at FROM supplier_sync_scopes WHERE company='TEST' AND list_group='FIAT'")).rows[0].next_run_at;
    const previousFetch=globalThis.fetch;
    globalThis.fetch=async (input,init)=>{
      assert.ok(!String(input).includes("MalzemeleriGetir") && !String(input).includes("ListeGrubuGetir"), "commerce uses cached catalog");
      return previousFetch(input,init);
    };
    const commercial=await importBasbug(pool,{group:"FIAT",warehouse:"MRK",company:"TEST",mode:"commerce"});
    assert.equal(commercial.stats.missing,0); assert.equal(commercial.stats.inactive,0);
    assert.equal((await client.query("SELECT missing_count FROM supplier_items WHERE code='D'")).rows[0].missing_count,1);
    assert.equal((await client.query("SELECT next_run_at FROM supplier_sync_scopes WHERE company='TEST' AND list_group='FIAT'")).rows[0].next_run_at.getTime(),fullDue.getTime());
    assert.equal((await client.query("SELECT observations FROM supplier_imports WHERE id=$1",[commercial.id])).rows[0].observations.MalzemeleriGetir,originalProductObservation);
    fail=true;
    await assert.rejects(importBasbug(pool,{group:"FIAT",warehouse:"MRK",company:"TEST",mode:"commerce"}));
    assert.equal((await client.query("SELECT commerce_failures FROM supplier_sync_scopes WHERE company='TEST' AND list_group='FIAT'")).rows[0].commerce_failures,1);
    fail=false; globalThis.fetch=previousFetch;
    await importBasbug(pool,{group:"FIAT",warehouse:"MRK",company:"TEST"});
    // Independent monitoring detects a stopped scheduler and stale individual groups.
    assert.equal((await supplierHealth(pool)).healthy,false);
    await client.query("INSERT INTO supplier_scheduler_health VALUES(true,now(),now(),true)");
    await client.query("UPDATE supplier_sync_scopes SET enabled=false WHERE list_group='AV'");
    assert.equal((await supplierHealth(pool)).healthy,true);
    await client.query("UPDATE supplier_scheduler_health SET started_at=now()-interval '2 hours',finished_at=now()-interval '2 hours'");
    assert.equal((await supplierHealth(pool)).healthy,false);
    await client.query("UPDATE supplier_scheduler_health SET started_at=now(),finished_at=now()");
    await client.query("UPDATE supplier_sync_scopes SET commerce_enabled=true,commerce_last_success_at=now()-interval '3 hours'");
    assert.equal((await supplierHealth(pool)).issues.length,1);
    await client.query("UPDATE supplier_sync_scopes SET commerce_last_success_at=now()");
    // The storefront stops purchasing commercial data before the older global age limit.
    await client.query(await readFile("db/commerce.sql","utf8"));
    await client.query("UPDATE supplier_items SET last_seen_at=now()-interval '3 hours' WHERE code='A'");
    const stale=(await client.query("SELECT price_kurus,available FROM commerce_catalog WHERE code='A'")).rows[0];
    assert.equal(stale.price_kurus,null); assert.equal(stale.available,false);
    await client.query("UPDATE supplier_items SET last_seen_at=now() WHERE code='A'");
    assert.ok((await client.query("SELECT price_kurus FROM commerce_catalog WHERE code='A'")).rows[0].price_kurus);
    // An explicitly reviewed true list contraction can recover from a rejection.
    codes=["A"];
    const reviewed=await importBasbug(pool,{ group:"FIAT",warehouse:"MRK",company:"TEST",acceptAnomaly:"Confirmed supplier group contraction, ticket 123" });
    assert.equal(reviewed.stats.missing,3);
    assert.match((await client.query("SELECT review_note FROM supplier_imports WHERE id=$1",[reviewed.id])).rows[0].review_note,/ticket 123/);
    // Prune old events and unreferenced runs, preserving current data and latest success metadata.
    await client.query("UPDATE supplier_item_changes SET changed_at=now()-interval '100 days'");
    await client.query("UPDATE supplier_imports SET completed_at=now()-interval '400 days' WHERE completed_at IS NOT NULL");
    const retention=await pruneSupplierHistory(client);
    assert.ok(retention.changes!>0); assert.ok(retention.runs!>0);
    assert.equal(Number((await client.query("SELECT count(*) FROM supplier_items")).rows[0].count),5);
    assert.ok(Number((await client.query("SELECT count(*) FROM supplier_imports WHERE status='succeeded'")).rows[0].count)>=1);
  } finally {
    globalThis.fetch=originalFetch;
    if (originalBase===undefined) delete process.env.BASBUG_BASE_URL; else process.env.BASBUG_BASE_URL=originalBase;
    envKeys.forEach((key,index)=>{ if(originalEnv[index]===undefined) delete process.env[key]; else process.env[key]=originalEnv[index]; });
    client.release(); await pool.end(); await control.query(`DROP SCHEMA ${namespace} CASCADE`); await control.query("SELECT pg_advisory_unlock(20261001,2)"); control.release(); await root.end();
  }
});
