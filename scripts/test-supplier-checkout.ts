import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes,randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";

test("checkout refresh rejects supplier failure and changed prices, preserves completed orders and snapshots", async()=> {
  const originalUrl=process.env.DATABASE_URL!;
  const originalCwd=process.cwd();
  const schemaSql=await readFile("db/schema.sql","utf8");
  const commerceSql=await readFile("db/commerce.sql","utf8");
  const root=new Pool({connectionString:originalUrl});
  const control=await root.connect();
  if (!(await control.query("SELECT pg_try_advisory_lock(20261001,2) AS locked")).rows[0].locked) {
    control.release(); await root.end();
    throw new Error("The live supplier scheduler is running; retry these integration tests when it finishes.");
  }
  const namespace=`checkout_test_${randomBytes(8).toString("hex")}`;
  await control.query(`CREATE SCHEMA ${namespace}`);
  const testUrl=new URL(originalUrl);testUrl.searchParams.set("options",`-c search_path=${namespace}`);
  process.env.DATABASE_URL=testUrl.toString();
  const {db}=await import("../src/lib/db");
  const {importBasbug}=await import("../src/modules/suppliers/basbug-import");
  const {submitOrder,cartQuote:quote,shippingRule}=await import("../src/modules/store/orders");
  const cartQuote=async(items:Parameters<typeof quote>[0],discount:number)=>quote(items,discount,await shippingRule());
  const {cartFor,setCartQuantity}=await import("../src/modules/store/cart");
  const originalFetch=globalThis.fetch;
  const keys=["TAMI_CHECKOUT_ENABLED","BASBUG_BASE_URL","BASBUG_USERNAME","BASBUG_PASSWORD","BASBUG_CLIENT_ID","BASBUG_CLIENT_SECRET","BASBUG_FIRMA_ADI"];
  const originalEnv=keys.map(key=>process.env[key]);
  let price=10,stock=1,fail=false,calls=0;
  // Keep the operator's real API pause marker intact; all fetches below are mocked.
  const testCwd=await mkdtemp(join(tmpdir(),"getirbakim-checkout-"));
  process.chdir(testCwd);
  try {
    await db.query(schemaSql);
    await db.query(commerceSql);
    await db.query(commerceSql);
    // The order line's compatibility level reads the vehicle catalog and product enrichments;
    // the full vehicle schema needs pg_trgm, which lives outside this test's search path.
    await db.query("CREATE TABLE vehicle_types(id integer PRIMARY KEY,model_id integer NOT NULL)");
    await db.query(await readFile(join(originalCwd,"db/product-enrichment.sql"),"utf8"));
    process.env.TAMI_CHECKOUT_ENABLED="true";process.env.BASBUG_BASE_URL="https://api.basbug.com.tr";
    for (const key of keys.slice(2)) process.env[key]="TEST";
    globalThis.fetch=async input=> {
      calls++;
      if(fail) throw new Error("test failure");
      const url=String(input);
      const body=url.includes("/auth/Login") ? {token:"test",tokenTipi:"Bearer",tokenBitisSuresi:300}
        :url.includes("ListeGrubuGetir") ? {malzemeGruplariListesi:[{kod:"FIAT",ad:"FIAT"}]}
        :url.includes("MalzemeleriGetir") ? {malzemeListesi:[{no:"PART",ac:"Part",ac2:"",uk:"TEST",oe:"",lgk:"FIAT",m:"",mo:"",y:"",b:"ADET",dc:"TL",lf:10,mkk:""}]}
        :url.includes("FiyatGetir") ? {fiyatListesi:[{no:"PART",nf:price,mif:price,k:0}]}
        :url.includes("StokGetir") ? {stokListesi:[{no:"PART",stok:stock,sYol:0,sDepo:new URL(url).searchParams.get("Depo"),sFarkliDepo:0}]}
        :{dovizListesi:[{dovizCinsi:"EUR",alis:"39",satis:"40"}]};
      return Response.json(body);
    };
    await importBasbug(db,{group:"FIAT",warehouse:"MRK",company:"TEST"});
    const owner={kind:"guest" as const,id:randomBytes(32).toString("hex")};
    await db.query("INSERT INTO guest_carts(token_hash) VALUES($1)",[owner.id]);
    const id=(await db.query("SELECT id FROM supplier_items")).rows[0].id;
    const vehicle={make:"Fiat",model:"Egea",year:2020,vehicleId:"999999"};
    assert.equal(await setCartQuantity(owner,id,1,true,vehicle),true);
    assert.deepEqual((await cartFor(owner))[0].vehicle,vehicle);
    // A later quantity change keeps the vehicle recorded when the product was added.
    assert.equal(await setCartQuantity(owner,id,1),true);
    assert.deepEqual((await cartFor(owner))[0].vehicle,vehicle);
    const input={requestKey:randomUUID(),quote:await cartQuote(await cartFor(owner),0),name:"Test",email:"test@example.invalid",phone:"5551234567",address:"Test",note:""};
    fail=true;assert.equal((await submitOrder(owner,input)).error,"supplier");
    assert.equal((await db.query("SELECT count(*) FROM commerce_orders")).rows[0].count,"0");
    fail=false;price=20;assert.equal((await submitOrder(owner,input)).error,"price");
    assert.equal((await cartFor(owner)).length,1);
    stock=0;assert.equal((await submitOrder(owner,input)).error,"stock");
    stock=1;input.quote=await cartQuote(await cartFor(owner),0);
    const order=await submitOrder(owner,input);assert.ok(order.id);
    const before=calls;fail=true;
    assert.equal((await submitOrder(owner,input)).id,order.id);assert.equal(calls,before);
    fail=false;price=50;await importBasbug(db,{group:"FIAT",warehouse:"MRK",company:"TEST",mode:"commerce"});
    const line=(await db.query("SELECT * FROM commerce_order_items WHERE order_id=$1",[order.id])).rows[0];
    assert.equal(line.pricing_snapshot.nf,20);assert.equal(Number(line.unit_price_kurus),3120);
    // Without fitment data the line is unknown, never a promise; the vehicle snapshot travels with it.
    assert.deepEqual(line.vehicle,vehicle);assert.equal(line.fitment_level,"unknown");
    assert.equal((await db.query("SELECT status FROM commerce_orders")).rows[0].status,"awaiting_payment");

    // Maintenance mode uses stored NF, stock and FX, without an API call.
    await db.query("UPDATE supplier_items SET last_seen_at=now()-interval '10 days',product_data=jsonb_set(product_data,'{dc}','\"EUR\"') WHERE id=$1",[id]);
    await db.query("UPDATE supplier_imports SET completed_at=now()-interval '10 days'");
    const stale=(await db.query("SELECT * FROM commerce_catalog WHERE id=$1",[id])).rows[0];
    assert.equal(stale.price_kurus,null);assert.equal(stale.available,false);
    await db.query("UPDATE commerce_settings SET basbug_checkout_mode='snapshot'");
    const stored=(await db.query("SELECT * FROM commerce_catalog WHERE id=$1",[id])).rows[0];
    assert.equal(stored.price_kurus,312000);assert.equal(stored.available,true);
    assert.equal(stored.pricing_snapshot.exchange_rate,40);
    assert.equal(stored.pricing_snapshot.checkout_mode,"snapshot");
    assert.equal(stored.pricing_snapshot.source_fresh,false);
    assert.match(stored.stock_label,/Kayıtlı stok/);
    const observedAt=stored.pricing_snapshot.observed_at,rateAt=stored.pricing_snapshot.rate_at;
    for(const [field,value] of [["price_data","null"],["stock_data","null"],["stock_data",'{"stok":0,"sFarkliDepo":0,"sYol":1}']]) {
      await db.query(`UPDATE supplier_items SET ${field}=$2::jsonb WHERE id=$1`,[id,value]);
      assert.equal(await setCartQuantity(owner,id,1),false);
      await db.query("UPDATE supplier_items SET price_data=$2::jsonb,stock_data=$3::jsonb WHERE id=$1",[id,JSON.stringify({nf:50,mif:50,k:0}),JSON.stringify({stok:1,sFarkliDepo:0,sYol:0,sDepo:"MRK"})]);
    }
    await db.query("UPDATE supplier_items SET product_data=jsonb_set(product_data,'{dc}','\"UNKNOWN\"') WHERE id=$1",[id]);
    assert.equal(await setCartQuantity(owner,id,1),false);
    await db.query("UPDATE supplier_items SET product_data=jsonb_set(product_data,'{dc}','\"EUR\"'),conflicting=true WHERE id=$1",[id]);
    assert.equal(await setCartQuantity(owner,id,1),false);
    await db.query("UPDATE supplier_items SET conflicting=false,presence='inactive' WHERE id=$1",[id]);
    assert.equal(await setCartQuantity(owner,id,1),false);
    await db.query("UPDATE supplier_items SET presence='present' WHERE id=$1",[id]);
    assert.equal(await setCartQuantity(owner,id,99),true);
    assert.equal(await setCartQuantity(owner,id,1,true),false);
    assert.equal(await setCartQuantity(owner,id,2),true);
    fail=true;const snapshotCalls=calls;
    const storedInput={...input,requestKey:randomUUID(),quote:await cartQuote(await cartFor(owner),0)};
    assert.equal((await submitOrder(owner,{...storedInput,quote:"0".repeat(64)})).error,"price");
    const storedOrders=await Promise.all([submitOrder(owner,storedInput),submitOrder(owner,storedInput)]);
    assert.ok(storedOrders[0].id);assert.equal(storedOrders[0].id,storedOrders[1].id);
    assert.equal(calls,snapshotCalls);assert.equal((await cartFor(owner)).length,1);
    const storedLine=(await db.query("SELECT * FROM commerce_order_items WHERE order_id=$1",[storedOrders[0].id])).rows[0];
    assert.equal(Number(storedLine.unit_price_kurus),312000);assert.equal(storedLine.quantity,2);
    assert.equal(storedLine.pricing_snapshot.observed_at,observedAt);assert.equal(storedLine.pricing_snapshot.rate_at,rateAt);
    assert.equal(storedLine.pricing_snapshot.checkout_mode,"snapshot");
    await db.query("UPDATE commerce_settings SET basbug_checkout_mode='live'");
    assert.equal((await submitOrder(owner,storedInput)).id,storedOrders[0].id);
    assert.equal(calls,snapshotCalls);
    assert.equal(await setCartQuantity(owner,id,1),false);
    await db.query("UPDATE supplier_items SET price_data=$2::jsonb WHERE id=$1",[id,JSON.stringify({nf:100,mif:100,k:0})]);
    assert.equal((await db.query("SELECT pricing_snapshot FROM commerce_order_items WHERE order_id=$1",[storedOrders[0].id])).rows[0].pricing_snapshot.nf,50);
  } finally {
    process.chdir(originalCwd);await rm(testCwd,{recursive:true,force:true});
    globalThis.fetch=originalFetch;process.env.DATABASE_URL=originalUrl;
    keys.forEach((key,index)=>{if(originalEnv[index]===undefined) delete process.env[key];else process.env[key]=originalEnv[index];});
    await db.end();await control.query(`DROP SCHEMA ${namespace} CASCADE`);await control.query("SELECT pg_advisory_unlock(20261001,2)");control.release();await root.end();
  }
});
