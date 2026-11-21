import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes,randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";

// A per-row LATERAL repeats the view's rate step per row and a plain join builds the whole view (#705, #1135, #1158, #1168):
// every by-id read of the catalog goes through catalogRowsByIdsSql / catalogRowsByIds.
const slice=(source:string,from:string,to?:string)=>{
  const start=source.indexOf(from);
  assert.ok(start>=0,from);
  return to?source.slice(start,source.indexOf(to,start)):source.slice(start);
};
const byIdReads:[string,string,string|undefined,string][]=[
  ["src/modules/store/cart.ts","export async function cartFor","export async function cartLineQuantity","catalogRowsByIdsSql("],
  ["src/modules/store/supplier-checkout.ts","export async function livePriceChanges",undefined,"catalogRowsByIdsSql("],
  ["src/modules/store/purchase-event.ts","const lineQuery","async function purchaseItems","catalogRowsByIdsSql("],
  ["src/modules/partner/orders.ts","async function offerRows","function unitPrice","catalogRowsByIds("],
  ["src/modules/store/catalog.ts","export async function getSetaEquivalents","/**","catalogRowsByIdsSql("],
  ["src/modules/store/catalog.ts","export async function getDecidedEquivalents","export function servicePrice","catalogRowsByIdsSql("],
  ["src/modules/admin/product-matching.ts","async function dinamikOnly","/** SETA products","catalogRowsByIdsSql("],
  ["src/modules/admin/product-matching.ts","async function setaReferences","// Listings, not raw rows","catalogRowsByIdsSql("],
  ["src/modules/admin/restock.ts","const offerCte","export async function markRestockNotified","catalogRowsByIdsSql("],
];
for(const [file,from,to,reader] of byIdReads) test(`${file} ${from.replace(/^.* /,"")} reads the catalog by id array (#1158, #1168)`, async()=> {
  const part=slice(await readFile(file,"utf8"),from,to);
  assert.ok(part.includes(reader),reader);
  assert.doesNotMatch(part,/JOIN LATERAL \(SELECT \* FROM \(\$\{catalogSql\}\)/);
  assert.doesNotMatch(part,/LEFT JOIN \(\$\{catalogSql\}\)/);
  assert.doesNotMatch(part,/JOIN LATERAL \([^)]*commerce_catalog/);
});

// Planning was most of these hot by-id reads' time (#1170): they go out as named prepared statements. rowsByIds returns
// the view's `*` row, so it is named on the pool only, never on a transaction's client.
const preparedReads:[string,string,string|undefined][]=[
  ["src/modules/store/cart.ts","export async function cartFor","export async function cartLineQuantity"],
  ["src/modules/store/catalog.ts","export async function getSetaEquivalents","/**"],
  ["src/modules/store/catalog.ts","export async function getDecidedEquivalents","export function servicePrice"],
  ["src/modules/store/catalog.ts","export async function getStorefrontProduct","/**"],
  ["src/modules/store/catalog.ts","async function rowsByIds","/**"],
];
for(const [file,from,to] of preparedReads) test(`${file} ${from.replace(/^.* /,"")} is a named prepared statement (#1170)`, async()=> {
  const part=slice(await readFile(file,"utf8"),from,to);
  assert.match(part,/preparedQuery(<[^(]*>)?\(/);
  if(from.endsWith("rowsByIds")) assert.ok(part.includes("connection===db"),"rowsByIds names its * read on the pool only");
});

test("submitOrder waits CHECKOUT_LOCK_TIMEOUT for supplier rows, then goes on without the share lock (#790)", async()=> {
  const source=await readFile("src/modules/store/orders.ts","utf8");
  const submitOrder=source.slice(source.indexOf("export async function submitOrder"),source.indexOf("export const orderStatus"));
  // The lock sequence is shared with partner orders (#426): submitOrder calls it, the helper holds the steps.
  assert.ok(submitOrder.includes("lockCheckoutSources(client,"));
  const helpers=await readFile("src/modules/store/supplier-checkout.ts","utf8");
  const lock=helpers.slice(helpers.indexOf("export async function lockCheckoutSources"),helpers.indexOf("export function checkedLineSnapshot"));
  for(const part of ["CHECKOUT_LOCK_TIMEOUT","SAVEPOINT supplier_rows","ROLLBACK TO SAVEPOINT supplier_rows","SET LOCAL lock_timeout = 0"])
    assert.ok(lock.includes(part),part);
});

test("livePriceChanges prices a live cost with the view's own commerce_*_price functions, not a copy (#882)", async()=> {
  const source=await readFile("src/modules/store/supplier-checkout.ts","utf8");
  const live=source.slice(source.indexOf("export async function livePriceChanges"));
  for(const name of ["commerce_formula_price(","commerce_campaign_price(","commerce_regular_price(","commerce_final_price("])
    assert.ok(live.includes(name),name);
  assert.doesNotMatch(live,/round\(/);
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
        :url.includes("/material/MalzemeAra") ? {no:new URL(url).searchParams.get("MalzemeNo"),ac:"BRAKE DISC",uk:"TEST",dc:"TL",nf:price,mif:price,k:0,sMrk:stock,...depots,sYol:0}
        :url.includes("ListeGrubuGetir") ? {malzemeGruplariListesi:[{kod:"FIAT",ad:"FIAT"}]}
        :url.includes("MalzemeleriGetir") ? {malzemeListesi:[{no:"PART",ac:"BRAKE DISC",ac2:"",uk:"TEST",oe:"",lgk:"FIAT",m:"",mo:"",y:"",b:"ADET",dc:"TL",lf:10,mkk:""}]}
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
    const input={requestKey:randomUUID(),quote:await cartQuote(await cartFor(owner),0),name:"Test",email:"test@example.invalid",phone:"5551234567",address:"Test Mahallesi 1. Sokak No 2, Kadıköy/İstanbul",note:"",province:"İstanbul",district:"Kadıköy",addressLine:"Test Mahallesi 1. Sokak No 2",postalCode:null,invoiceType:"individual" as const,invoiceCompany:null,invoiceTaxNo:null,invoiceTaxOffice:null};
    const itemRow=async()=>(await db.query("SELECT product_data,price_data,stock_data,last_seen_at,changed_at FROM supplier_items WHERE id=$1",[id])).rows[0];
    // #763: the live check asks MalzemeAra for the cart's own code only, without the list endpoints or the import lock.
    const listUrls=/FiyatGetir|StokGetir|MalzemeleriGetir|ListeGrubuGetir|DovizBilgisiGetir/;
    // #1172: the repriced row is re-checked for price anomalies in the same request, against the real schema
    // (product_sources included): no failure or skip is logged, and an ordinary price change leaves no anomaly.
    const loggedError=console.error;const anomalyLogs:unknown[]=[];
    console.error=(...args:unknown[])=>{if(args.some(arg=>typeof arg==="object"&&arg!==null&&"priceAnomalies" in arg)) anomalyLogs.push(args);else loggedError(...args);};
    urls.length=0;price=20;
    try { assert.equal((await submitOrder(owner,input)).error,"price"); } finally { console.error=loggedError; }
    assert.deepEqual(anomalyLogs,[]);
    assert.equal((await db.query("SELECT 1 FROM supplier_price_anomalies WHERE supplier_item_id=$1",[id])).rowCount,0);
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
    // #952: the line keeps the name the cart showed (the Turkish name of a known English supplier name), not the raw one.
    assert.equal(line.name,"Fren Diski");assert.equal(line.code,"PART");
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
      // Only MRK has stock (the saved StokGetir-only depots are emptied), so a live MRK of 0 is out of stock everywhere.
      await savedDepots({IZM:0,IAN:0,KYS:0,TRK:0});
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
        assert.deepEqual(refused.products,[id]);
        assert.ok(performance.now()-started<3_000,"the checkout does not wait on the import");
        // #788: the live answer says out of stock in every depot (or a new cost) but cannot be saved: refused and named,
        // never sold on the saved stock and price.
        stock=0;const soldOut=await submitOrder(cart,lockedInput);stock=1;
        assert.deepEqual([soldOut.error,soldOut.products],["stock",[id]]);
        const savedPrice=price;price=savedPrice+1;const repriced=await submitOrder(cart,lockedInput);price=savedPrice;
        assert.deepEqual([repriced.error,repriced.products],["price",[id]]);
      } finally {
        gone=false;stock=1;clearTimeout(safety);
        await holder.query("ROLLBACK").catch(()=>undefined);holder.release();
      }
      assert.equal((await itemRow()).stock_data.stok,stockBefore);
      assert.equal(await checkoutChanges(),changesBefore);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM commerce_orders WHERE owner_kind='guest' AND owner_id=$1",[cart.id])).rows[0].n,0);
    }
    {
      // #861: a live cost the locked rows keep from being saved refuses its line only if the sale price would change.
      // Saved nf is 50: the formula (×1.3 profit, ×1.2 VAT) sells at 7800 kuruş. The override row is created before
      // any lock (its FK to supplier_items would wait on the holder); later price edits leave the key alone.
      const {livePriceChanges}=await import("../src/modules/store/supplier-checkout");
      const savedNf=(await itemRow()).price_data.nf;assert.equal(savedNf,50);
      await db.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id) VALUES($1,$2)",[id,randomUUID()]);
      const setPrices=(fixed:number|null,sale:number|null)=>db.query("UPDATE commerce_item_overrides SET price_kurus=$2,sale_price_kurus=$3 WHERE supplier_item_id=$1",[id,fixed,sale]);
      const catalogPrice=async()=>(await db.query("SELECT price_kurus FROM commerce_catalog WHERE id=$1",[id])).rows[0].price_kurus;
      // Parity: the saved cost recomputed by livePriceChanges is the catalog's own price, whatever priced it, and a
      // cost moved by `delta` changes it exactly when the view's rules say so.
      const parity=async(expected:number,delta:number,changes:boolean)=>{
        const price=await catalogPrice();
        assert.equal(price,expected);
        assert.deepEqual(await livePriceChanges(db,[{id,nf:savedNf,price}]),[]);
        assert.deepEqual(await livePriceChanges(db,[{id,nf:savedNf+delta,price}]),changes ? [id] : []);
        // Compared with the price the order charges: a stale one (a pull committed after cartFor) is a change.
        assert.deepEqual(await livePriceChanges(db,[{id,nf:savedNf,price:price-1}]),[id]);
      };
      // #882: the view inlines the formula and campaign-window functions (a per-row call would make full scans slower;
      // a SET/STRICT clause or an expensive argument used twice breaks the inline silently) and calls the fixed/final
      // price functions only behind its admin_priced branch.
      const plan=(await db.query("EXPLAIN (VERBOSE, COSTS OFF) SELECT price_kurus FROM commerce_catalog WHERE id=$1::uuid",[id])).rows
        .map(row=>row["QUERY PLAN"]).join("\n");
      assert.doesNotMatch(plan,/commerce_formula_price\(/);
      assert.doesNotMatch(plan,/commerce_campaign_price\(/);
      assert.match(plan,/commerce_regular_price\(/);
      assert.deepEqual(await livePriceChanges(db,[]),[]);
      await parity(7800,1,true);
      await setPrices(9000,null);await parity(9000,1,false);
      await setPrices(null,7500);await parity(7500,1,false);
      await setPrices(null,null);
      const pricingAdmin=(await db.query("INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Test','parity@example.invalid','test','admin',true) RETURNING id")).rows[0].id;
      await db.query("INSERT INTO commerce_product_pricing(supplier_item_id,markup_percent,vat_percent,updated_by) VALUES($1,50,10,$2)",[id,pricingAdmin]);
      // 50 × 1.5 × 1.1: 8250; 50.001 rounds to the same price, 50.01 does not.
      await parity(8250,0.001,false);
      await parity(8250,0.01,true);
      await db.query("DELETE FROM commerce_product_pricing WHERE supplier_item_id=$1",[id]);
      await db.query("DELETE FROM accounts WHERE id=$1",[pricingAdmin]);
      // A EUR row with a rate that is not a whole number: 50 × 41.3579 × 156 = 322591.62 -> 322592.
      const currencies=(await db.query("SELECT DISTINCT currencies_data FROM supplier_imports WHERE supplier='basbug'")).rows;
      assert.equal(currencies.length,1);
      await db.query(`UPDATE supplier_imports SET currencies_data='{"dovizListesi":[{"dovizCinsi":"EUR","alis":"41","satis":"41.3579"}]}' WHERE supplier='basbug'`);
      await db.query(`UPDATE supplier_items SET product_data=jsonb_set(product_data,'{dc}','"EUR"') WHERE id=$1`,[id]);
      const setCampaign=(fixed:number|null,sale:number|null,from:string|null,until:string|null)=>db.query(
        "UPDATE commerce_item_overrides SET price_kurus=$2,sale_price_kurus=$3,sale_from=now()+$4::interval,sale_until=now()+$5::interval WHERE supplier_item_id=$1",[id,fixed,sale,from,until]);
      try {
        await setCampaign(null,null,null,null);await parity(322592,0.01,true);
        await setCampaign(400000,null,null,null);await parity(400000,0.01,false);
        // Campaign in its window, below the regular price.
        await setCampaign(null,300000,"-1 day","1 day");await parity(300000,0.01,false);
        // Not started yet, or already over: the formula's price.
        await setCampaign(null,300000,"1 day",null);await parity(322592,0.01,true);
        await setCampaign(null,300000,null,"-1 second");await parity(322592,0.01,true);
        // At or above the regular price: ignored.
        await setCampaign(null,400000,null,null);await parity(322592,0.01,true);
        // Equal to it: ignored while it is, so a lower cost moves the price, but a higher one brings the campaign in at
        // the same price.
        await setCampaign(null,322592,null,null);await parity(322592,-0.01,true);await parity(322592,0.01,false);
        // Fixed plus a campaign below it: the campaign; a cost the campaign cannot drop under does not move it.
        await setCampaign(400000,350000,null,null);await parity(350000,0.01,false);
        // Fixed plus a campaign above it: the fixed price.
        await setCampaign(300000,350000,null,null);await parity(300000,0.01,false);
      } finally {
        await setCampaign(null,null,null,null);
        await db.query(`UPDATE supplier_items SET product_data=jsonb_set(product_data,'{dc}','"TL"') WHERE id=$1`,[id]);
        await db.query("UPDATE supplier_imports SET currencies_data=$1::jsonb WHERE supplier='basbug'",[JSON.stringify(currencies[0].currencies_data)]);
      }
      assert.equal(await catalogPrice(),7800);
      // #1030: an open currency anomaly leaves the row unpriced, so a line charged at its old price is a change;
      // a dismissed one prices it as before.
      await db.query("INSERT INTO supplier_price_anomalies(supplier_item_id,supplier,evidence) VALUES($1,'basbug','{}')",[id]);
      try {
        assert.equal(await catalogPrice(),null);
        assert.deepEqual(await livePriceChanges(db,[{id,nf:savedNf,price:7800}]),[id]);
        await db.query("UPDATE supplier_price_anomalies SET status='dismissed' WHERE supplier_item_id=$1",[id]);
        await parity(7800,1,true);
      } finally { await db.query("DELETE FROM supplier_price_anomalies WHERE supplier_item_id=$1",[id]); }

      const checkoutChanges=async()=>(await db.query("SELECT count(*)::int AS n FROM supplier_item_changes WHERE item_id=$1 AND after_data->>'source'='checkout'",[id])).rows[0].n;
      const changesBefore=await checkoutChanges();
      // A fresh cart and quote, then the order while a holder keeps the row locked and MalzemeAra quotes `livePrice`.
      const lockedOrder=async(livePrice:number)=>{
        const cart=await newCart();assert.equal(await setCartQuantity(cart,id,1),true);
        const lockedInput=await checkoutInput(cart);
        const holder=await db.connect();
        let safety:ReturnType<typeof setTimeout>|undefined;
        const savedPrice=price;
        try {
          await holder.query("BEGIN");
          await holder.query("SELECT id FROM supplier_items WHERE id=$1 FOR UPDATE",[id]);
          safety=setTimeout(()=>{holder.query("ROLLBACK").catch(()=>undefined);},5_000);
          price=livePrice;return await submitOrder(cart,lockedInput);
        } finally {
          price=savedPrice;clearTimeout(safety);
          await holder.query("ROLLBACK").catch(()=>undefined);holder.release();
        }
      };
      const soldLine=async(order:{id?:string;error?:string})=>{
        assert.ok(order.id,String(order.error));
        return (await db.query("SELECT unit_price_kurus,pricing_snapshot FROM commerce_order_items WHERE order_id=$1",[order.id])).rows[0];
      };
      const marks=(line:{pricing_snapshot:Record<string,unknown>})=>[line.pricing_snapshot.checkout_mode,line.pricing_snapshot.live_check,line.pricing_snapshot.live_check_reason,line.pricing_snapshot.live_check_nf];
      // A cost that rounds to the same price (50.001 × 156 = 7800.156): sold at 7800, marked busy with the live cost.
      let line=await soldLine(await lockedOrder(50.001));
      assert.equal(Number(line.unit_price_kurus),7800);
      assert.deepEqual(marks(line),["snapshot","failed","busy",50.001]);
      assert.equal(line.pricing_snapshot.nf,50);
      // A fixed price: a new cost does not move it, so the line is sold at 9000.
      await setPrices(9000,null);
      line=await soldLine(await lockedOrder(51));
      assert.equal(Number(line.unit_price_kurus),9000);
      assert.deepEqual(marks(line),["snapshot","failed","busy",51]);
      // A campaign below the regular price: 51 prices at 7956, still above 7500, so the campaign holds.
      await setPrices(null,7500);
      line=await soldLine(await lockedOrder(51));
      assert.equal(Number(line.unit_price_kurus),7500);
      assert.deepEqual(marks(line),["snapshot","failed","busy",51]);
      // 48 prices at 7488, below the campaign: the campaign no longer applies and the price would change.
      const refused=await lockedOrder(48);
      assert.deepEqual([refused.error,refused.products],["price",[id]]);
      await db.query("DELETE FROM commerce_item_overrides WHERE supplier_item_id=$1",[id]);
      // Nothing was written: the saved cost stays and no checkout change was recorded.
      assert.equal((await itemRow()).price_data.nf,savedNf);
      assert.equal(await checkoutChanges(),changesBefore);
    }
    {
      // #770/#790: the supplier answers but the rows stay locked past lock_timeout: the line is sold on its saved data,
      // marked "busy", while the import (here a holder) still holds the row. The order transaction's FOR SHARE gives up
      // after CHECKOUT_LOCK_TIMEOUT too; without that it would wait: the holder lets go after 5 s so the test fails, not hangs.
      const cart=await newCart();assert.equal(await setCartQuantity(cart,id,1),true);
      const busyInput=await checkoutInput(cart);
      const holder=await db.connect();
      let safety:ReturnType<typeof setTimeout>|undefined;
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT id FROM supplier_items WHERE id=$1 FOR UPDATE",[id]);
        safety=setTimeout(()=>{holder.query("ROLLBACK").catch(()=>undefined);},5_000);
        const started=performance.now();
        const busy=await submitOrder(cart,busyInput);
        assert.ok(performance.now()-started<3_000,"the order does not wait for the import to commit");
        assert.ok(busy.id,String(busy.error));
        const marked=(await db.query("SELECT pricing_snapshot FROM commerce_order_items WHERE order_id=$1",[busy.id])).rows[0].pricing_snapshot;
        assert.deepEqual([marked.checkout_mode,marked.live_check,marked.live_check_reason],["snapshot","failed","busy"]);
      } finally {
        clearTimeout(safety);
        await holder.query("ROLLBACK").catch(()=>undefined);holder.release();
      }
    }

    // Admin prices (#580): with nf 50 the formula sells at 78.00; a fixed 90.00 and a running 80.00 campaign override it.
    const buyer={kind:"guest" as const,id:randomBytes(32).toString("hex")};
    await db.query("INSERT INTO guest_carts(token_hash) VALUES($1)",[buyer.id]);
    await db.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,name,price_kurus,sale_price_kurus,sale_until) VALUES($1,$2,'FREN DISKI ON ELLE',9000,8000,now()+interval '1 day')",[id,randomUUID()]);
    assert.equal(await setCartQuantity(buyer,id,1,true),true);
    assert.equal((await cartFor(buyer))[0].price_kurus,8000);
    const campaignInput={...input,requestKey:randomUUID(),quote:await cartQuote(await cartFor(buyer),0)};
    // The campaign ends between the quote and the order: the price moved, so the order is refused.
    await db.query("UPDATE commerce_item_overrides SET sale_until=now()-interval '1 second' WHERE supplier_item_id=$1",[id]);
    assert.equal((await submitOrder(buyer,campaignInput)).error,"price");
    campaignInput.quote=await cartQuote(await cartFor(buyer),0);
    const fixedOrder=await submitOrder(buyer,campaignInput);assert.ok(fixedOrder.id);
    const fixedLine=async()=>(await db.query("SELECT name,unit_price_kurus,pricing_snapshot FROM commerce_order_items WHERE order_id=$1",[fixedOrder.id])).rows[0];
    let placed=await fixedLine();
    // #952: an admin's name wins over the Turkish and readable names and is stored as written.
    assert.equal(placed.name,"FREN DISKI ON ELLE");
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
    assert.match(stored.stock_label,/^Stokta · /);
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
    {
      // #790: a list import holds the cart's rows with an uncommitted new price. In "Kayıtlı veriler" mode the order does
      // not wait for its commit: it is placed on the committed (pre-import) price without a supplier call.
      const cart=await newCart();assert.equal(await setCartQuantity(cart,id,1),true);
      const pulledInput=await checkoutInput(cart);
      const committedPrice=(await cartFor(cart))[0].price_kurus;
      const holder=await db.connect();
      let safety:ReturnType<typeof setTimeout>|undefined;
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT id FROM supplier_items WHERE id=$1 FOR UPDATE",[id]);
        await holder.query("UPDATE supplier_items SET price_data=$2::jsonb WHERE id=$1",[id,JSON.stringify({nf:70,mif:70,k:0})]);
        safety=setTimeout(()=>{holder.query("ROLLBACK").catch(()=>undefined);},5_000);
        const callsBefore=calls,started=performance.now();
        const pulled=await submitOrder(cart,pulledInput);
        assert.ok(performance.now()-started<3_000,"the order does not wait for the import to commit");
        assert.ok(pulled.id,String(pulled.error));
        assert.equal(calls,callsBefore);
        const pulledLine=(await db.query("SELECT unit_price_kurus,pricing_snapshot FROM commerce_order_items WHERE order_id=$1",[pulled.id])).rows[0];
        assert.equal(pulledLine.pricing_snapshot.checkout_mode,"snapshot");
        assert.equal(pulledLine.pricing_snapshot.live_check,undefined);
        assert.equal(Number(pulledLine.unit_price_kurus),committedPrice);
        assert.equal(pulledLine.pricing_snapshot.nf,50);
      } finally {
        clearTimeout(safety);
        await holder.query("ROLLBACK").catch(()=>undefined);holder.release();
      }
    }
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

test("a named read on a pool survives a view gaining a column: the stale plan's client is dropped, the read retried (#1170)", async()=> {
  // Placed last: src/lib/db creates its pool on import, which the checkout test above does with its own schema.
  const {preparedQuery}=await import("../src/lib/db");
  const root=new Pool({connectionString:process.env.DATABASE_URL});
  const namespace=`prepared_test_${randomBytes(8).toString("hex")}`;
  const view=`${namespace}.v`;
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,idleTimeoutMillis:0});
  const raw=await root.connect();
  try {
    await root.query(`CREATE SCHEMA ${namespace}`);
    await root.query(`CREATE VIEW ${view} AS SELECT 1 AS a`);
    const sql=`SELECT * FROM ${view}`;
    assert.deepEqual((await preparedQuery(pool,sql,[])).rows,[{a:1}]);
    // Named: the pool's only connection now holds the statement.
    assert.equal((await pool.query<{count:number}>("SELECT count(*)::int AS count FROM pg_prepared_statements")).rows[0].count,1);
    const stalePid=(await pool.query<{pid:number}>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await raw.query({name:"prepared_test_raw",text:sql,values:[]});
    await root.query(`CREATE OR REPLACE VIEW ${view} AS SELECT 1 AS a,2 AS b`);
    // The failure this guards against: the same named statement on a connection that prepared it.
    await assert.rejects(raw.query({name:"prepared_test_raw",text:sql,values:[]}),(error:{code?:string})=>error.code==="0A000");
    assert.deepEqual((await preparedQuery(pool,sql,[])).rows,[{a:1,b:2}]);
    // The client holding the stale plan was dropped, not returned to the pool.
    assert.notEqual((await pool.query<{pid:number}>("SELECT pg_backend_pid() AS pid")).rows[0].pid,stalePid);
    // The replacement client prepares the new shape.
    assert.deepEqual((await preparedQuery(pool,sql,[])).rows,[{a:1,b:2}]);
  } finally {
    raw.release(true);await pool.end();
    await root.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);await root.end();
  }
});
