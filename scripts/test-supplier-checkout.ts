import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes,randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";

test("cart lines look up the catalog per line, never one catalog-wide scan per line (#705)", async()=> {
  const source=await readFile("src/modules/store/cart.ts","utf8");
  const cartFor=source.slice(source.indexOf("export async function cartFor"),source.indexOf("export async function cartLineQuantity"));
  assert.match(cartFor,/LEFT JOIN LATERAL \(SELECT \* FROM \(\$\{catalogSql\}\) priced WHERE priced\.id=c\.product_id OFFSET 0\) p ON true/);
  assert.doesNotMatch(cartFor,/LEFT JOIN \(\$\{catalogSql\}\)/);
});

test("checkout refresh rejects supplier failure and changed prices, preserves completed orders and snapshots", async t=> {
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
  const {cartFor,cartLineQuantity,cartQuantity,setCartQuantity}=await import("../src/modules/store/cart");
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
    await db.query("CREATE TABLE vehicle_brands(id integer PRIMARY KEY,display_name text);CREATE TABLE vehicle_models(id integer PRIMARY KEY,brand_id integer,name text);CREATE TABLE vehicle_types(id integer PRIMARY KEY,model_id integer NOT NULL,name text,fuel_type text,kwt integer,hp integer,cc integer,year_of_constr_from date,year_of_constr_to date)");
    for(const name of ["product-enrichment","product-fitments","product-matching","product-overrides","product-override-fitments","enrichment-worker","enrichment-products","enrichment-shared-links"])
      await db.query(await readFile(join(originalCwd,`db/${name}.sql`),"utf8"));
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
    // The add-to-cart dialog reads only its own line's quantity (#705).
    assert.equal(await cartLineQuantity(owner,id),1);
    assert.equal(await cartLineQuantity(owner,randomUUID()),0);
    // Add-to-cart actions return the cart total for the header badge instead of revalidating the layout (#707).
    assert.equal(await cartQuantity(owner),1);
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

    // Admin prices (#580): with nf 50 the formula sells at 78.00; a fixed 90.00 and a running 80.00 campaign override it.
    const buyer={kind:"guest" as const,id:randomBytes(32).toString("hex")};
    await db.query("INSERT INTO guest_carts(token_hash) VALUES($1)",[buyer.id]);
    await db.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,price_kurus,sale_price_kurus,sale_until) VALUES($1,$2,9000,8000,now()+interval '1 day')",[id,randomUUID()]);
    assert.equal(await setCartQuantity(buyer,id,1,true),true);
    assert.equal((await cartFor(buyer))[0].price_kurus,8000);
    const campaignInput={...input,requestKey:randomUUID(),quote:await cartQuote(await cartFor(buyer),0)};
    // The campaign ends between the quote and the order: the price moved, so the order is refused.
    await db.query("UPDATE commerce_item_overrides SET sale_until=now()-interval '1 second' WHERE supplier_item_id=$1",[id]);
    assert.equal((await submitOrder(buyer,campaignInput)).error,"price");
    campaignInput.quote=await cartQuote(await cartFor(buyer),0);
    const fixedOrder=await submitOrder(buyer,campaignInput);assert.ok(fixedOrder.id);
    const fixedLine=async()=>(await db.query("SELECT unit_price_kurus,pricing_snapshot FROM commerce_order_items WHERE order_id=$1",[fixedOrder.id])).rows[0];
    let placed=await fixedLine();
    assert.equal(Number(placed.unit_price_kurus),9000);
    assert.deepEqual([placed.pricing_snapshot.source,placed.pricing_snapshot.price_kind,placed.pricing_snapshot.auto_price_kurus,placed.pricing_snapshot.fixed_price_kurus,
      Number(placed.pricing_snapshot.cost_kurus),placed.pricing_snapshot.nf,placed.pricing_snapshot.discount_percent],["override","fixed",7800,9000,5000,50,0]);
    // A later price change never touches the placed line.
    await db.query("UPDATE commerce_item_overrides SET price_kurus=12000 WHERE supplier_item_id=$1",[id]);
    assert.equal((await db.query("SELECT price_kurus FROM commerce_catalog WHERE id=$1",[id])).rows[0].price_kurus,12000);
    placed=await fixedLine();
    assert.equal(Number(placed.unit_price_kurus),9000);assert.equal(placed.pricing_snapshot.fixed_price_kurus,9000);
    await db.query("DELETE FROM commerce_item_overrides WHERE supplier_item_id=$1",[id]);

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
    const admin=(await db.query("INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Test','pricing@example.invalid','test','admin',true) RETURNING id")).rows[0].id;
    await db.query("INSERT INTO commerce_product_pricing(supplier_item_id,markup_percent,vat_percent,updated_by) VALUES($1,50,10,$2)",[id,admin]);
    assert.equal((await submitOrder(owner,storedInput)).error,"price");
    storedInput.quote=await cartQuote(await cartFor(owner),0);
    const storedOrders=await Promise.all([submitOrder(owner,storedInput),submitOrder(owner,storedInput)]);
    assert.ok(storedOrders[0].id);assert.equal(storedOrders[0].id,storedOrders[1].id);
    assert.equal(calls,snapshotCalls);assert.equal((await cartFor(owner)).length,1);
    const storedLine=(await db.query("SELECT * FROM commerce_order_items WHERE order_id=$1",[storedOrders[0].id])).rows[0];
    assert.equal(Number(storedLine.unit_price_kurus),330000);assert.equal(storedLine.quantity,2);
    assert.equal(storedLine.pricing_snapshot.markup_percent,50);assert.equal(storedLine.pricing_snapshot.vat_percent,10);
    assert.equal(storedLine.pricing_snapshot.observed_at,observedAt);assert.equal(storedLine.pricing_snapshot.rate_at,rateAt);
    assert.equal(storedLine.pricing_snapshot.checkout_mode,"snapshot");
    await db.query("UPDATE commerce_settings SET basbug_checkout_mode='live'");
    assert.equal((await submitOrder(owner,storedInput)).id,storedOrders[0].id);
    assert.equal(calls,snapshotCalls);
    assert.equal(await setCartQuantity(owner,id,1),false);
    await db.query("UPDATE supplier_items SET price_data=$2::jsonb WHERE id=$1",[id,JSON.stringify({nf:100,mif:100,k:0})]);
    assert.equal((await db.query("SELECT pricing_snapshot FROM commerce_order_items WHERE order_id=$1",[storedOrders[0].id])).rows[0].pricing_snapshot.nf,50);
    await db.query("DELETE FROM commerce_product_pricing WHERE supplier_item_id=$1",[id]);
    assert.equal((await db.query("SELECT pricing_snapshot FROM commerce_order_items WHERE order_id=$1",[storedOrders[0].id])).rows[0].pricing_snapshot.markup_percent,50);
    assert.equal((await db.query("SELECT pricing_snapshot FROM commerce_order_items WHERE order_id=$1",[order.id])).rows[0].pricing_snapshot.markup_percent,30);

    // #711: a cart with SETA and Başbuğ lines refreshes both suppliers side by side (mocked, 150 ms per request).
    {
      const setaKeys=["SETA_API_KEY","SETA_BASE_URL","SUPPLIER_EGRESS_PROXY"],setaEnv=setaKeys.map(key=>process.env[key]);
      const baseFetch=globalThis.fetch;
      const requests:{supplier:string;start:number;end:number}[]=[];
      try {
        fail=false;process.env.SETA_API_KEY="TEST";delete process.env.SETA_BASE_URL;delete process.env.SUPPLIER_EGRESS_PROXY;
        const {importSeta}=await import("../src/modules/suppliers/seta-import");
        const setaRows=[{product_no:"STO-711",product_name:"TEST 1.6",price:"100.00",currency:"TRY",stock:true,image:"",oems:[],category:"Yağ Filtreleri",brand:null,cross:[]}];
        globalThis.fetch=async(input,init)=>{
          const url=String(input),supplier=url.includes("/seta/products") ? "seta" : "basbug",start=performance.now();
          await new Promise(resolve=>setTimeout(resolve,150));
          const response=supplier==="seta" ? Response.json(setaRows) : await baseFetch(input,init);
          requests.push({supplier,start,end:performance.now()});
          return response;
        };
        await importSeta(db);
        await importBasbug(db,{group:"FIAT",warehouse:"MRK",company:"TEST",mode:"commerce"});
        const setaId=(await db.query("SELECT id FROM supplier_items WHERE supplier='seta'")).rows[0].id;
        const mixed={kind:"guest" as const,id:randomBytes(32).toString("hex")};
        await db.query("INSERT INTO guest_carts(token_hash) VALUES($1)",[mixed.id]);
        assert.equal(await setCartQuantity(mixed,setaId,1),true);
        assert.equal(await setCartQuantity(mixed,id,1),true);
        requests.length=0;
        const started=performance.now();
        const mixedOrder=await submitOrder(mixed,{...input,requestKey:randomUUID(),quote:await cartQuote(await cartFor(mixed),0)});
        const elapsed=performance.now()-started;
        assert.ok(mixedOrder.id,String(mixedOrder.error));
        const seta=requests.filter(r=>r.supplier==="seta"),basbug=requests.filter(r=>r.supplier==="basbug");
        assert.equal(seta.length,1);assert.ok(basbug.length>1);
        assert.ok(seta.some(a=>basbug.some(b=>a.start<b.end && b.start<a.end)),"SETA and Başbuğ requests should overlap");
        const serialMs=requests.length*150;
        t.diagnostic(`mixed cart checkout: ${Math.round(elapsed)} ms for ${requests.length} supplier requests (serial at least ~${serialMs} ms)`);
        assert.equal((await db.query("SELECT count(*) FROM commerce_order_items WHERE order_id=$1",[mixedOrder.id])).rows[0].count,"2");
      } finally {
        globalThis.fetch=baseFetch;
        setaKeys.forEach((key,index)=>{if(setaEnv[index]===undefined) delete process.env[key];else process.env[key]=setaEnv[index];});
      }
    }
  } finally {
    process.chdir(originalCwd);await rm(testCwd,{recursive:true,force:true});
    globalThis.fetch=originalFetch;process.env.DATABASE_URL=originalUrl;
    keys.forEach((key,index)=>{if(originalEnv[index]===undefined) delete process.env[key];else process.env[key]=originalEnv[index];});
    await db.end();await control.query(`DROP SCHEMA ${namespace} CASCADE`);await control.query("SELECT pg_advisory_unlock(20261001,2)");control.release();await root.end();
  }
});
