import assert from 'node:assert/strict';
import { randomBytes,createHash } from 'node:crypto';
import { compare } from 'bcryptjs';
import { Pool } from 'pg';
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const base=process.env.VERIFY_URL ?? 'http://localhost:3100';
const email=`brand-verify-${randomBytes(8).toString('hex')}@example.invalid`;
const password='synthetic-verification-password';
let accountId:string|undefined,adminCookie='';
function fields(html:string,match:(form:string)=>boolean) {
 const form=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(m=>m[1]).find(f=>f.includes('$ACTION_ID_') && match(f));
 assert.ok(form,'Expected server action form');const values=new URLSearchParams();
 for(const input of form.matchAll(/<input\b[^>]*>/g)) { const name=input[0].match(/name="([^"]+)"/)?.[1];if(name) values.set(name,input[0].match(/value="([^"]*)"/)?.[1] ?? ''); }
 return values;
}
async function page(path:string,cookie='') {const result=await fetch(base+path,{headers:{cookie},redirect:'manual'});assert.equal(result.status,200,path);return result.text();}
async function post(path:string,values:URLSearchParams,cookie='',origin=base) {const body=new FormData();for(const [k,v] of values)body.set(k,v);return fetch(base+path,{method:'POST',headers:{origin,cookie},body,redirect:'manual'});}
try {
 const home=await page('/');assert.ok(home.includes('birlikte bakalım'));assert.ok(home.includes('logo-light.svg'));assert.ok(!home.includes('getirbakım'));
 const services=await page('/servisler');assert.ok(services.includes('moto-kurye'));assert.ok(services.includes('/servisler/basvuru'));
 const application=fields(await page('/servisler/basvuru'),form=>form.includes('name="contactName"'));
 for(const [key,value] of Object.entries({name:'Brand verification service',contactName:'Test contact',city:'İstanbul',phone:'05550000000',email,password,terms:'on',website:'',role:'admin',approved:'true',discount:'50'}))application.set(key,value);
 const denied=await post('/servisler/basvuru',application,'','https://foreign.example.invalid');assert.ok(denied.status>=400,'Foreign origin denied');
 const submitted=await post('/servisler/basvuru',application);assert.equal(submitted.status,303);assert.ok(submitted.headers.get('location')?.includes('sent=1'));assert.ok(!submitted.headers.get('set-cookie')?.includes('gb_session'));
 const account=(await pool.query('SELECT * FROM accounts WHERE email=$1',[email])).rows[0];accountId=account.id;assert.equal(account.role,'service');assert.equal(account.approved,false);assert.equal(account.discount_percent,0);assert.equal(account.contact_name,'Test contact');assert.ok(await compare(password,account.password_hash));
 const login=fields(await page('/giris'),form=>form.includes('name="password"'));login.set('email',email);login.set('password',password);
 const pending=await post('/giris',login);assert.ok(pending.headers.get('location')?.includes('error=1'));
 const duplicate=await post('/servisler/basvuru',application);assert.ok(duplicate.headers.get('location')?.includes('sent=1'));assert.equal((await pool.query('SELECT count(*) FROM accounts WHERE email=$1',[email])).rows[0].count,'1');
 await post('/servisler/basvuru',application);
 const limited=await post('/servisler/basvuru',application);assert.ok(limited.headers.get('location')?.includes('error=limit'),'Email abuse budget enforced');
 const admin=fields(await page('/giris'),form=>form.includes('name="password"'));admin.set('email',process.env.ADMIN_EMAIL!);admin.set('password',process.env.ADMIN_PASSWORD!);
 const auth=await post('/giris',admin);assert.equal(auth.status,303);adminCookie=auth.headers.getSetCookie().find(c=>c.startsWith('gb_session='))?.split(';')[0] ?? '';assert.ok(adminCookie);
 const adminPage=await page('/yonetim',adminCookie);assert.ok(adminPage.includes('Test contact'));
 const approval=fields(adminPage,form=>form.includes(`value="${accountId}"`));approval.set('discount','15');
 const unauthorized=await post('/yonetim',approval);assert.ok(unauthorized.headers.get('location')?.includes('/giris'));
 const approved=await post('/yonetim',approval,adminCookie);assert.equal(approved.status,303);assert.equal((await pool.query('SELECT approved FROM accounts WHERE id=$1',[accountId])).rows[0].approved,true);
 const serviceLogin=await post('/giris',login);assert.ok(serviceLogin.headers.getSetCookie().some(c=>c.startsWith('gb_session=')));
 const serviceCookie=serviceLogin.headers.getSetCookie().find(c=>c.startsWith('gb_session='))!.split(';')[0];
 const serviceAdmin=await fetch(base+'/yonetim',{headers:{cookie:serviceCookie},redirect:'manual'});assert.equal(serviceAdmin.status,307);
 const robots=await page('/robots.txt');assert.ok(robots.includes('Disallow: /yonetim'));assert.ok(robots.includes('/sitemap.xml'));
 const sitemap=await page('/sitemap.xml');assert.ok(sitemap.includes('/servisler'));assert.ok(!sitemap.includes('/servisler/basvuru'));
 console.log('PASS: brand copy/assets, B2B application, CSRF, pending login denial, duplicate isolation, password hash, admin approval, approved login, service/admin boundary, robots and sitemap.');
} finally {
 if(adminCookie)await pool.query('DELETE FROM sessions WHERE token_hash=$1',[createHash('sha256').update(adminCookie.slice('gb_session='.length)).digest('hex')]);
 if(accountId)await pool.query('DELETE FROM accounts WHERE id=$1',[accountId]);
 await pool.query('DELETE FROM login_attempts WHERE email=$1',[email]);
 await pool.query('DELETE FROM service_application_attempts WHERE key=$1',[createHash('sha256').update(email).digest('hex')]);
 // The application requests consume the global abuse budget as real requests do.
 await pool.end();
}
