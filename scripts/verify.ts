import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { hash } from "bcryptjs";
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const base=process.env.VERIFY_URL ?? "http://localhost:3100";
const suffix=randomBytes(6).toString("hex");
const email=`verify-${suffix}@example.invalid`, password=randomBytes(20).toString("hex"),code=`GB-VERIFY-${suffix}`;
let accountId:string|undefined,productId:string|undefined,createdServiceId:string|undefined,guestHash:string|undefined,cookie="";
function fields(html:string,predicate:(form:string)=>boolean=()=>true) {
 const form=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(m=>m[1]).find(f=>f.includes("$ACTION_ID_") && predicate(f));
 assert.ok(form,"Expected action form");
 const values=new URLSearchParams();
 for(const input of form.matchAll(/<input\b[^>]*>/g)) {
  const name=input[0].match(/name="([^"]+)"/)?.[1];
  const value=input[0].match(/value="([^"]*)"/)?.[1];
  if(name)values.set(name,value ?? "");
 }
 assert.ok([...values.keys()].some(k=>k.startsWith("$ACTION_ID_")),"Expected server action");
 return values;
}
async function get(path:string,authorized=false) {return fetch(base+path,{headers:authorized ? {cookie}: {},redirect:"manual"});}
async function post(path:string,data:URLSearchParams,authorized=false,origin=base) {
 const body=new FormData(); for (const [k,v] of data) body.set(k,v);
 return fetch(base+path,{method:"POST",headers:{origin,...(authorized?{cookie}:{})},body,redirect:"manual"});
}
try {
 assert.ok(Number((await pool.query("SELECT count(*) AS total FROM media_assets")).rows[0].total)>=52,"Local media assets registered");
 const info=await pool.query("select current_database() as database,current_user as role");
 assert.deepEqual(info.rows[0],{database:"getirbakim",role:"getirbakim_app"});
 accountId=(await pool.query("INSERT INTO accounts(name,email,password_hash,role,approved,discount_percent) VALUES('Verification service',$1,$2,'service',true,10) RETURNING id",[email,await hash(password,12)])).rows[0].id;
 productId=(await pool.query("INSERT INTO products(supplier,code,name,brand,description,price_kurus,stock,category) VALUES('demo',$1,'Verification synthetic product','VERIFY','Synthetic verification data',10000,3,'fren') RETURNING id",[code])).rows[0].id;
 const anon=await get(`/katalog?q=${code}`);assert.equal(anon.status,200);const anonHtml=await anon.text();assert.ok(anonHtml.includes(code));
 assert.ok(!(await (await get("/katalog?searchBy=code&q=Verification%20synthetic%20product")).text()).includes(code));
 assert.ok((await (await get("/katalog?searchBy=all&q=Verification%20synthetic%20product")).text()).includes(code));assert.ok(anonHtml.includes("100,00"));assert.ok(anonHtml.includes("Bireysel satış fiyatı"));assert.ok(!anonHtml.includes("90,00"));
 const detail=await get(`/urun/${productId}`);assert.equal(detail.status,200);const detailHtml=await detail.text();assert.ok(detailHtml.includes("100,00"));assert.ok(detailHtml.includes("Sepete ekle"));
 const guestFields=fields(detailHtml,f=>f.includes('name="productId"'));guestFields.set("quantity","1");
 const guestAdded=await post("/sepet",guestFields);assert.equal(guestAdded.status,303);cookie=guestAdded.headers.getSetCookie().find(c=>c.startsWith("gb_cart="))?.split(";")[0] ?? "";assert.ok(cookie.startsWith("gb_cart="));
 guestHash=createHash("sha256").update(cookie.slice("gb_cart=".length)).digest("hex");
 const guestPage=await get("/sepet",true);assert.ok((await guestPage.text()).includes("100,00"));
 assert.ok(!(await (await get("/sepet")).text()).includes(code),"Another guest cannot see this cart");
 await post("/sepet",guestFields,true);
 assert.equal((await pool.query("SELECT quantity FROM commerce_cart_items WHERE owner_kind='guest' AND owner_id=$1",[guestHash])).rows[0].quantity,2);
 guestFields.set("quantity","2");const guestOverstock=await post("/sepet",guestFields,true);assert.ok(guestOverstock.headers.get("location")?.includes("error=stock"));
 assert.ok((await (await get(`/katalog?category=fren`)).text()).includes(code));assert.ok(!(await (await get(`/katalog?category=filtre`)).text()).includes(code));
 await pool.query("INSERT INTO commerce_cart_items(owner_kind,owner_id,product_id,quantity) VALUES('account',$1,$2,1)",[accountId,productId]);
 assert.equal((await get("/yonetim")).status,307);assert.equal((await get("/sepet")).status,200);
 const loginPage=await get("/giris");const loginFields=fields(await loginPage.text(),f=>f.includes('name="password"'));loginFields.set("email",email);loginFields.set("password",password);
 const denied=await post("/giris",loginFields,false,"https://invalid-origin.example");assert.ok(denied.status>=400,"Foreign origin must be rejected");
 const logged=await post("/giris",loginFields,true);assert.equal(logged.status,303);cookie=logged.headers.getSetCookie().find(c=>c.startsWith("gb_session="))?.split(";")[0] ?? "";assert.ok(cookie.startsWith("gb_session="));assert.ok(logged.headers.get("set-cookie")?.includes("HttpOnly"));
 assert.equal((await pool.query("SELECT quantity FROM commerce_cart_items WHERE owner_kind='account' AND owner_id=$1 AND product_id=$2",[accountId,productId])).rows[0].quantity,3,"Guest cart merged with account cart");
 assert.equal((await pool.query("SELECT * FROM guest_carts WHERE token_hash=$1",[guestHash])).rowCount,1,"Guest order session remains available");
 const serviceAdmin=await get("/yonetim",true);assert.equal(serviceAdmin.status,307);assert.equal(serviceAdmin.headers.get("location"),"/");
 const authedDetail=await get(`/urun/${productId}`,true);const authedHtml=await authedDetail.text();assert.ok(authedHtml.includes("90,00"),"Discounted price should be 90 TRY");
 const cartFields=fields(authedHtml,f=>f.includes('name="productId"'));cartFields.set("quantity","2");cartFields.set("mode","set");
 assert.equal((await post("/sepet",cartFields,true)).status,303);
 let cart=await pool.query("SELECT quantity FROM commerce_cart_items WHERE owner_kind='account' AND owner_id=$1 AND product_id=$2",[accountId,productId]);assert.equal(cart.rows[0].quantity,2);
 const cartPage=await get("/sepet",true);assert.ok((await cartPage.text()).includes("180,00"));
 cartFields.set("quantity","4");const overstock=await post("/sepet",cartFields,true);assert.equal(overstock.status,303);assert.ok(overstock.headers.get("location")?.includes("error=stock"));
 cart=await pool.query("SELECT quantity FROM commerce_cart_items WHERE owner_kind='account' AND owner_id=$1 AND product_id=$2",[accountId,productId]);assert.equal(cart.rows[0].quantity,2);
 cartFields.set("quantity","0");await post("/sepet",cartFields,true);
 assert.equal((await pool.query("SELECT * FROM commerce_cart_items WHERE owner_kind='account' AND owner_id=$1",[accountId])).rowCount,0);
 const garageForm=fields(await (await get("/garaj")).text(),f=>f.includes('name="make"'));garageForm.set("make","Volkswagen");garageForm.set("model","Verification Golf");garageForm.set("year","2018");
 const garageSaved=await post("/garaj",garageForm);assert.equal(garageSaved.status,303);const vehicleCookie=garageSaved.headers.getSetCookie().find(c=>c.startsWith("gb_vehicle="))?.split(";")[0] ?? "";assert.ok(vehicleCookie);
 const garagePage=await fetch(base+"/garaj",{headers:{cookie:vehicleCookie}});assert.ok((await garagePage.text()).includes("Verification Golf"));
 const adminHash=(await pool.query("SELECT password_hash FROM accounts WHERE email=$1 AND role='admin'",[process.env.ADMIN_EMAIL])).rows[0];assert.ok(adminHash);assert.notEqual(adminHash.password_hash,process.env.ADMIN_PASSWORD);
 const adminLogin=fields(await (await get("/giris")).text(),f=>f.includes('name="password"'));adminLogin.set("email",process.env.ADMIN_EMAIL!);adminLogin.set("password",process.env.ADMIN_PASSWORD!);
 const adminResponse=await post("/giris",adminLogin);assert.equal(adminResponse.status,303);cookie=adminResponse.headers.get("set-cookie")?.split(";")[0] ?? "";
 const adminPage=await get("/yonetim",true);assert.equal(adminPage.status,200);const adminHtml=await adminPage.text();assert.ok(adminHtml.includes("Doğrulama bekliyor"));assert.ok(!adminHtml.includes(process.env.DINAMIK_APIKEY!));assert.ok(!adminHtml.includes(process.env.BASBUG_CLIENT_SECRET!));
 const createFields=fields(adminHtml,f=>f.includes('name="discount"'));createFields.set("name","Verification created service");createFields.set("email",`created-${email}`);createFields.set("password",password);createFields.set("discount","15");
 const created=await post("/yonetim",createFields,true);assert.equal(created.status,303);assert.ok(created.headers.get("location")?.includes("created=1"));
 const createdAccount=(await pool.query("SELECT id,approved,discount_percent FROM accounts WHERE email=$1",[`created-${email}`])).rows[0];createdServiceId=createdAccount?.id;assert.equal(createdAccount.approved,true);assert.equal(createdAccount.discount_percent,15);
 console.log("PASS: media registry; search mode; garage persistence; B2C public prices; guest cart persistence and isolation; additive quantities; guest-to-B2B merge; category filtering; administrator login and service approval; supplier secrets hidden; isolated database; public retail versus B2B pricing; admin authorization; CSRF origin; login; search/detail; persistent cart; discount/total; stock rejection; removal; hashed passwords.");
} finally {
 if(guestHash)await pool.query("DELETE FROM guest_carts WHERE token_hash=$1",[guestHash]);
 if(createdServiceId)await pool.query("DELETE FROM accounts WHERE id=$1",[createdServiceId]);
 if(cookie) await pool.query("DELETE FROM sessions WHERE token_hash=$1",[createHash("sha256").update(cookie.slice("gb_session=".length)).digest("hex")]);
 if(accountId)await pool.query("DELETE FROM accounts WHERE id=$1",[accountId]);
 if(productId)await pool.query("DELETE FROM products WHERE id=$1",[productId]);
 await pool.query("DELETE FROM login_attempts WHERE email=$1",[email]);
 await pool.end();
}
