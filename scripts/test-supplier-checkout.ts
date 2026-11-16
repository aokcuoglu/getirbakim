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

test("checkout checks cart codes live, falls back on supplier failure with a marker, preserves completed orders and snapshots", async t=> {
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
  // Unset for the whole test: requests go to the mocked fetch, and Dinamik has no configuration (its fallback below).
  const unset=["SUPPLIER_EGRESS_PROXY","SUPPLIER_EGRESS_PROXY_FOR","DINAMIK_BASE","DINAMIK_APIKEY","DINAMIK_SECRETKEY"];
  const originalEnv=[...keys,...unset].map(key=>process.env[key]);
  let price=10,stock=1,fail=false,gone=false,calls=0;
  // MalzemeAra's other depots (#763); MRK follows `stock`.
  const depots={sIzm:0,sAnk:0,sAdn:0,sErz:0};
  const urls:string[]=[];
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
    for (const key of unset) delete process.env[key];
    globalThis.fetch=async input=> {
      calls++;
      const url=String(input);urls.push(url);
      if(fail) throw new Error("test failure");
      // MalzemeAra answers a code it no longer knows with HTTP 604 and a plain-text body (new Response rejects 604).
      if(url.includes("/material/MalzemeAra") && gone) return {ok:false,status:604,json:async()=>{throw new Error("not JSON");},text:async()=>"Malzeme bulunamadı!"} as unknown as Response;
      const body=url.includes("/auth/Login") ? {token:"test",tokenTipi:"Bearer",tokenBitisSuresi:300}
        :url.includes("/material/MalzemeAra") ? {no:new URL(url).searchParams.get("MalzemeNo"),ac:"Part",uk:"TEST",dc:"TL",nf:price,mif:price,k:0,sMrk:stock,...depots,sYol:0}
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
    const itemRow=async()=>(await db.query("SELECT product_data,price_data,stock_data,last_seen_at,changed_at FROM supplier_items WHERE id=$1",[id])).rows[0];
    // #763: the live check asks MalzemeAra for the cart's own code only, without the list endpoints or the import lock.
    const listUrls=/FiyatGetir|StokGetir|MalzemeleriGetir|ListeGrubuGetir|DovizBilgisiGetir/;
    urls.length=0;price=20;assert.equal((await submitOrder(owner,input)).error,"price");
    assert.ok(urls.some(url=>url.includes("/material/MalzemeAra")));assert.doesNotMatch(urls.join(" "),listUrls);
    assert.ok(urls.filter(url=>url.includes("/auth/Login")).length<=1);
    assert.equal((await itemRow()).price_data.nf,20);
    assert.ok((await db.query("SELECT 1 FROM supplier_item_changes WHERE item_id=$1 AND import_id IS NULL AND after_data->>'source'='checkout'",[id])).rowCount);
    assert.equal((await cartFor(owner)).length,1);
    // Availability is cumulative over all depots: zero everywhere (MalzemeAra's and the saved StokGetir-only ones) is out of stock.
    const savedDepots=async(values:Record<string,number>)=>{
      for(const [depot,value] of Object.entries(values))
        await db.query("UPDATE supplier_items SET stock_data=jsonb_set(stock_data,ARRAY['depolar',$2::text,'stok'],to_jsonb($3::numeric)) WHERE id=$1",[id,depot,value]);
    };
    await savedDepots({IAN:0,KYS:0,TRK:0});
    stock=0;assert.equal((await submitOrder(owner,input)).error,"stock");
    stock=1;input.quote=await cartQuote(await cartFor(owner),0);
    // Depots MalzemeAra does not return, in-transit stock and product fields belong to the list imports and stay as they were.
    await savedDepots({KYS:7});
    await db.query(`UPDATE supplier_items SET stock_data=jsonb_set(stock_data,'{sYol}','2') WHERE id=$1`,[id]);
    const checked=await itemRow();
    urls.length=0;
    const order=await submitOrder(owner,input);assert.ok(order.id);
    assert.doesNotMatch(urls.join(" "),listUrls);assert.ok(urls.filter(url=>url.includes("/auth/Login")).length<=1);
    const after=await itemRow();
    assert.deepEqual(after.product_data,checked.product_data);
    assert.deepEqual([after.stock_data.depolar.KYS.stok,after.stock_data.sYol,after.stock_data.stok,after.stock_data.depolar.MRK.stok,after.stock_data.depolar.IZM.stok,after.stock_data.depolar.ANK.stok],[7,2,1,1,0,0]);
    // sFarkliDepo is recomputed over every depot except MRK: only KYS has stock now.
    assert.equal(after.stock_data.sFarkliDepo,7);
    assert.ok(after.last_seen_at>checked.last_seen_at);
    assert.equal((await db.query("SELECT pricing_snapshot FROM commerce_order_items WHERE order_id=$1",[order.id])).rows[0].pricing_snapshot.live_check,undefined);
    const before=calls;fail=true;
    assert.equal((await submitOrder(owner,input)).id,order.id);assert.equal(calls,before);
    fail=false;price=50;await importBasbug(db,{group:"FIAT",warehouse:"MRK",company:"TEST",mode:"commerce"});
    const line=(await db.query("SELECT * FROM commerce_order_items WHERE order_id=$1",[order.id])).rows[0];
    assert.equal(line.pricing_snapshot.nf,20);assert.equal(Number(line.unit_price_kurus),3120);
    // Without fitment data the line is unknown, never a promise; the vehicle snapshot travels with it.
    assert.deepEqual(line.vehicle,vehicle);assert.equal(line.fitment_level,"unknown");
    assert.equal((await db.query("SELECT status FROM commerce_orders")).rows[0].status,"awaiting_payment");

    // #763 fallbacks, each with its own cart and request key.
    const newCart=async()=>{
      const cart={kind:"guest" as const,id:randomBytes(32).toString("hex")};
      await db.query("INSERT INTO guest_carts(token_hash) VALUES($1)",[cart.id]);
      return cart;
    };
    const checkoutInput=async(cart:{kind:"guest";id:string})=>({...input,requestKey:randomUUID(),quote:await cartQuote(await cartFor(cart),0)});
    {
      // 604: the supplier no longer knows the code, so it is out of stock until a list import decides its presence.
      const cart=await newCart();assert.equal(await setCartQuantity(cart,id,1),true);
      const goneInput=await checkoutInput(cart);
      const seenBefore=(await itemRow()).last_seen_at;
      gone=true;assert.equal((await submitOrder(cart,goneInput)).error,"stock");gone=false;
      const row=await itemRow();
      // Not a sighting: last_seen_at stays, the zeroed stock is still recorded as a checkout change.
      assert.deepEqual(row.last_seen_at,seenBefore);
      assert.ok((await db.query("SELECT 1 FROM supplier_item_changes WHERE item_id=$1 AND after_data->>'source'='checkout' AND (after_data#>>'{stock,stok}')::numeric=0 AND (after_data#>>'{stock,sFarkliDepo}')::numeric=0",[id])).rowCount);
      assert.deepEqual([row.stock_data.stok,row.stock_data.sFarkliDepo],[0,0]);
      assert.ok(Object.values(row.stock_data.depolar as Record<string,{stok:number}>).every(depot=>depot.stok===0));
      assert.equal((await db.query("SELECT presence FROM supplier_items WHERE id=$1",[id])).rows[0].presence,"present");
      // The next check sees the code again and the same quote is accepted.
      assert.ok((await submitOrder(cart,goneInput)).id);
    }
    {
      // Any depot can supply the order (#763): MRK empty but ANK (MalzemeAra) or KYS (saved, StokGetir only) in stock still sells.
      await savedDepots({IZM:0,IAN:0,KYS:0,TRK:0});
      stock=0;depots.sAnk=2;
      const other=await newCart();assert.equal(await setCartQuantity(other,id,1),true);
      const otherOrder=await submitOrder(other,await checkoutInput(other));
      assert.ok(otherOrder.id,String(otherOrder.error));
      let row=await itemRow();
      assert.deepEqual([row.stock_data.stok,row.stock_data.depolar.ANK.stok,row.stock_data.sFarkliDepo,row.stock_data.depolar.IAN.stok],[0,2,2,0]);
      depots.sAnk=0;await savedDepots({KYS:1});
      const saved=await newCart();assert.equal(await setCartQuantity(saved,id,1),true);
      const savedOrder=await submitOrder(saved,await checkoutInput(saved));
      assert.ok(savedOrder.id,String(savedOrder.error));
      row=await itemRow();
      assert.deepEqual([row.stock_data.depolar.ANK.stok,row.stock_data.depolar.KYS.stok,row.stock_data.sFarkliDepo],[0,1,1]);
      // Nothing anywhere: out of stock.
      const none=await newCart();assert.equal(await setCartQuantity(none,id,1),true);
      const noneInput=await checkoutInput(none);
      await savedDepots({KYS:0});
      assert.equal((await submitOrder(none,noneInput)).error,"stock");
      stock=1;await importBasbug(db,{group:"FIAT",warehouse:"MRK",company:"TEST",mode:"commerce"});
    }
    {
      // The supplier cannot be reached: the order is placed on the saved (still fresh) data and the line is marked.
      const cart=await newCart();assert.equal(await setCartQuantity(cart,id,1),true);
      const fallbackInput=await checkoutInput(cart);
      const seen=(await itemRow()).last_seen_at;
      fail=true;const fallback=await submitOrder(cart,fallbackInput);fail=false;
      assert.ok(fallback.id,String(fallback.error));
      const marked=(await db.query("SELECT pricing_snapshot FROM commerce_order_items WHERE order_id=$1",[fallback.id])).rows[0].pricing_snapshot;
      assert.deepEqual([marked.checkout_mode,marked.live_check,marked.live_check_reason],["snapshot","failed","upstream"]);
      assert.deepEqual((await itemRow()).last_seen_at,seen);
      // Freshness is not relaxed: a stale record is refused even when the supplier is down.
      const staleCart=await newCart();assert.equal(await setCartQuantity(staleCart,id,1),true);
      const staleInput=await checkoutInput(staleCart);
      await db.query("UPDATE supplier_items SET last_seen_at=now()-interval '10 days' WHERE id=$1",[id]);
      fail=true;assert.equal((await submitOrder(staleCart,staleInput)).error,"stock");fail=false;
      await db.query("UPDATE supplier_items SET last_seen_at=now() WHERE id=$1",[id]);
    }
    {
      // Dinamik without configuration: its line falls back marked "config", the Başbuğ line next to it is confirmed live.
      const dinamikId=(await db.query(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,product_count,price_count,stock_count,first_seen_at,last_seen_at,changed_at)
        VALUES('dinamik','DINAMIK','TEST','ALL','DIN-763','{"ac":"Dinamik test","uk":"TEST","dc":"TRY"}','{"nf":10}','{"stok":1}',1,1,1,now(),now(),now()) RETURNING id::text`)).rows[0].id;
      const cart=await newCart();
      assert.equal(await setCartQuantity(cart,dinamikId,1),true);assert.equal(await setCartQuantity(cart,id,1),true);
      const mixed=await submitOrder(cart,await checkoutInput(cart));
      assert.ok(mixed.id,String(mixed.error));
      const lines=Object.fromEntries((await db.query("SELECT product_id::text,pricing_snapshot FROM commerce_order_items WHERE order_id=$1",[mixed.id])).rows.map(row=>[row.product_id,row.pricing_snapshot]));
      assert.deepEqual([lines[dinamikId].live_check,lines[dinamikId].live_check_reason],["failed","config"]);
      assert.equal(lines[id].live_check,undefined);assert.equal(lines[id].checkout_mode,"live");
    }
    {
      // #770: rows a running import keeps locked. A code the supplier no longer knows (604) is refused even though its
      // zeroed stock cannot be saved; nothing is written and no order is created.
      const cart=await newCart();assert.equal(await setCartQuantity(cart,id,1),true);
      const lockedInput=await checkoutInput(cart);
      const stockBefore=(await itemRow()).stock_data.stok;assert.ok(stockBefore>0);
      const checkoutChanges=async()=>(await db.query("SELECT count(*)::int AS n FROM supplier_item_changes WHERE item_id=$1 AND after_data->>'source'='checkout'",[id])).rows[0].n;
      const changesBefore=await checkoutChanges();
      const holder=await db.connect();
      // Without the #770 refusal the order transaction would wait on this lock: let go after 5 s so the test fails, not hangs.
      let safety:ReturnType<typeof setTimeout>|undefined;
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT id FROM supplier_items WHERE id=$1 FOR UPDATE",[id]);
        safety=setTimeout(()=>{holder.query("ROLLBACK").catch(()=>undefined);},5_000);
        const started=performance.now();
        gone=true;const refused=await submitOrder(cart,lockedInput);gone=false;
        assert.equal(refused.error,"stock");
        assert.ok(performance.now()-started<3_000,"the checkout does not wait on the import");
      } finally {
        gone=false;clearTimeout(safety);
        await holder.query("ROLLBACK").catch(()=>undefined);holder.release();
      }
      assert.equal((await itemRow()).stock_data.stok,stockBefore);
      assert.equal(await checkoutChanges(),changesBefore);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM commerce_orders WHERE owner_kind='guest' AND owner_id=$1",[cart.id])).rows[0].n,0);
    }
    {
      // #770: the supplier answers but the rows stay locked past lock_timeout: the line is sold on its saved data, marked
      // "busy", once the import (here a holder) lets the order transaction read the row. The holder lets go only after
      // the order transaction is seen waiting on its FOR SHARE, i.e. after the refresh has already given up.
      const cart=await newCart();assert.equal(await setCartQuantity(cart,id,1),true);
      const busyInput=await checkoutInput(cart);
      const holder=await db.connect();
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT id FROM supplier_items WHERE id=$1 FOR UPDATE",[id]);
        const started=performance.now();
        const pending=submitOrder(cart,busyInput);
        let waiting=false;
        while(!waiting && performance.now()-started<10_000) {
          await new Promise(resolve=>setTimeout(resolve,50));
          waiting=Boolean((await db.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR SHARE OF p%'")).rowCount);
        }
        await holder.query("ROLLBACK");
        const busy=await pending;
        assert.ok(waiting,"the order transaction waited on the held row");
        assert.ok(busy.id,String(busy.error));
        const marked=(await db.query("SELECT pricing_snapshot FROM commerce_order_items WHERE order_id=$1",[busy.id])).rows[0].pricing_snapshot;
        assert.deepEqual([marked.checkout_mode,marked.live_check,marked.live_check_reason],["snapshot","failed","busy"]);
      } finally {
        await holder.query("ROLLBACK").catch(()=>undefined);holder.release();
      }
    }

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
        assert.equal(seta.length,1);assert.ok(basbug.length>=1);
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
    [...keys,...unset].forEach((key,index)=>{if(originalEnv[index]===undefined) delete process.env[key];else process.env[key]=originalEnv[index];});
    await db.end();await control.query(`DROP SCHEMA ${namespace} CASCADE`);await control.query("SELECT pg_advisory_unlock(20261001,2)");control.release();await root.end();
  }
});
