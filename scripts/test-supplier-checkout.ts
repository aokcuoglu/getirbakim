import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes,randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

test("checkout refresh rejects supplier failure and changed prices, preserves completed orders and snapshots", async()=> {
  const originalUrl=process.env.DATABASE_URL!;
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
  const {submitOrder,cartQuote}=await import("../src/modules/store/orders");
  const {cartFor,setCartQuantity}=await import("../src/modules/store/cart");
  const originalFetch=globalThis.fetch;
  const keys=["BASBUG_BASE_URL","BASBUG_USERNAME","BASBUG_PASSWORD","BASBUG_CLIENT_ID","BASBUG_CLIENT_SECRET","BASBUG_FIRMA_ADI"];
  const originalEnv=keys.map(key=>process.env[key]);
  let price=10,stock=1,fail=false,calls=0;
  try {
    await db.query(await readFile("db/schema.sql","utf8"));
    await db.query(await readFile("db/commerce.sql","utf8"));
    process.env.BASBUG_BASE_URL="https://api.basbug.com.tr";
    for (const key of keys.slice(1)) process.env[key]="TEST";
    globalThis.fetch=async input=> {
      calls++;
      if(fail) throw new Error("test failure");
      const url=String(input);
      const body=url.includes("/auth/Login") ? {token:"test",tokenTipi:"Bearer",tokenBitisSuresi:300}
        :url.includes("ListeGrubuGetir") ? {malzemeGruplariListesi:[{kod:"FIAT",ad:"FIAT"}]}
        :url.includes("MalzemeleriGetir") ? {malzemeListesi:[{no:"PART",ac:"Part",ac2:"",uk:"TEST",oe:"",lgk:"FIAT",m:"",mo:"",y:"",b:"ADET",dc:"TL",lf:10,mkk:""}]}
        :url.includes("FiyatGetir") ? {fiyatListesi:[{no:"PART",nf:price,mif:price,k:0}]}
        :url.includes("StokGetir") ? {stokListesi:[{no:"PART",stok:stock,sYol:0,sDepo:new URL(url).searchParams.get("Depo"),sFarkliDepo:0}]}
        :{dovizListesi:[]};
      return Response.json(body);
    };
    await importBasbug(db,{group:"FIAT",warehouse:"MRK",company:"TEST"});
    const owner={kind:"guest" as const,id:randomBytes(32).toString("hex")};
    await db.query("INSERT INTO guest_carts(token_hash) VALUES($1)",[owner.id]);
    const id=(await db.query("SELECT id FROM supplier_items")).rows[0].id;
    assert.equal(await setCartQuantity(owner,id,1),true);
    const input={requestKey:randomUUID(),quote:cartQuote(await cartFor(owner),0),name:"Test",email:"test@example.invalid",phone:"5551234567",address:"Test",note:""};
    fail=true;assert.equal((await submitOrder(owner,input)).error,"supplier");
    assert.equal((await db.query("SELECT count(*) FROM commerce_orders")).rows[0].count,"0");
    fail=false;price=20;assert.equal((await submitOrder(owner,input)).error,"price");
    assert.equal((await cartFor(owner)).length,1);
    stock=0;assert.equal((await submitOrder(owner,input)).error,"stock");
    stock=1;input.quote=cartQuote(await cartFor(owner),0);
    const order=await submitOrder(owner,input);assert.ok(order.id);
    const before=calls;fail=true;
    assert.equal((await submitOrder(owner,input)).id,order.id);assert.equal(calls,before);
    fail=false;price=50;await importBasbug(db,{group:"FIAT",warehouse:"MRK",company:"TEST",mode:"commerce"});
    const line=(await db.query("SELECT * FROM commerce_order_items WHERE order_id=$1",[order.id])).rows[0];
    assert.equal(line.pricing_snapshot.nf,20);assert.equal(Number(line.unit_price_kurus),3120);
    assert.equal((await db.query("SELECT status FROM commerce_orders")).rows[0].status,"pending");
  } finally {
    globalThis.fetch=originalFetch;process.env.DATABASE_URL=originalUrl;
    keys.forEach((key,index)=>{if(originalEnv[index]===undefined) delete process.env[key];else process.env[key]=originalEnv[index];});
    await db.end();await control.query(`DROP SCHEMA ${namespace} CASCADE`);await control.query("SELECT pg_advisory_unlock(20261001,2)");control.release();await root.end();
  }
});
