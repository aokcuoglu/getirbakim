import assert from "node:assert/strict";
import { test, after } from "node:test";
import { createHash } from "node:crypto";
import { serviceApplicationSchema } from "../src/modules/auth/schemas";
import { buildPgAuthToken, buildSecurityHash, verifySecurityHash, createHostedToken, queryPaymentByOrderId, verifiedPaymentSuccess, type TamiQueryResponse } from "../src/modules/payments/tami";
const keys = ['TAMI_MERCHANT_NUMBER','TAMI_TERMINAL_NUMBER','TAMI_SECRET_KEY','TAMI_JWK_KID','TAMI_JWK_K','TAMI_PAYMENT_API_BASE_URL','TAMI_PORTAL_BASE_URL'];
const original = Object.fromEntries(keys.map(key => [key,process.env[key]]));
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch=originalFetch; for(const key of keys) { if(original[key] === undefined) delete process.env[key]; else process.env[key]=original[key]; } });
Object.assign(process.env,{TAMI_MERCHANT_NUMBER:'test-merchant',TAMI_TERMINAL_NUMBER:'test-terminal',TAMI_SECRET_KEY:'synthetic-test-secret',TAMI_JWK_KID:'test-kid',TAMI_JWK_K:Buffer.from('synthetic-test-hmac-key').toString('base64url'),TAMI_PAYMENT_API_BASE_URL:'https://sandbox-paymentapi.tami.com.tr',TAMI_PORTAL_BASE_URL:'https://sandbox-portal.tami.com.tr'});
test('service application rejects privilege injection, malformed phone, consent omission and bcrypt truncation', () => {
 const valid={name:'Test servis',contactName:'Test yetkili',city:'İstanbul',phone:'+90 555 000 00 00',email:'TEST@example.invalid',password:'test-password-123',terms:'on',website:''};
 const parsed=serviceApplicationSchema.parse({...valid,approved:true,discount:50,role:'admin'});
 assert.equal(parsed.email,'test@example.invalid');assert.ok(!('role' in parsed));assert.ok(!('discount' in parsed));
 for(const change of [{terms:''},{website:'spam'},{phone:'123456789'},{password:'ş'.repeat(40)},{password:'short'}]) assert.equal(serviceApplicationSchema.safeParse({...valid,...change}).success,false);
});
test('TAMI verifies signed body and rejects tampering, malformed tokens and extra segments', () => {
 assert.equal(buildPgAuthToken(),`test-merchant:test-terminal:${createHash('sha256').update('test-merchanttest-terminalsynthetic-test-secret').digest('base64')}`);
 const payload={orderId:'test-order',amount:199.99,currency:'TRY'};
 const signature=buildSecurityHash(payload);
 assert.equal(verifySecurityHash({...payload,securityHash:signature},signature),true);
 assert.equal(verifySecurityHash({...payload,amount:199.98},signature),false);
 for(const bad of ['not-a-jwt',signature+'.extra',signature.slice(0,-4)]) assert.equal(verifySecurityHash(payload,bad),false);
});
test('payment acceptance requires exact order, TRY, signed settled result and exact kurus', () => {
 const query:TamiQueryResponse={currency:'TRY',success:true,orderId:'test-order',orderStatus:'AUTH',paymentStatus:null,amount:199.99,installmentCount:1,securityHashValid:true,bankReferenceNumber:null,bankAuthCode:null,transactionStatus:'SUCCESS',raw:{}};
 assert.equal(verifiedPaymentSuccess(query,'test-order',19999),true);
 for(const change of [{currency:'USD'},{orderId:'other'},{amount:199.98},{amount:199.991},{amount:NaN},{securityHashValid:false},{transactionStatus:'PENDING'},{success:false}]) assert.equal(verifiedPaymentSuccess({...query,...change},'test-order',19999),false);
 assert.equal(verifiedPaymentSuccess(query,'test-order',19999.1),false);
});
test('hosted payment and query transport use gb endpoint contract with signed query', async () => {
 globalThis.fetch=async (url,options) => {
  assert.equal(options?.method,'POST');assert.equal(options?.cache,'no-store');assert.ok(options?.signal);
  const headers=new Headers(options?.headers);assert.equal(headers.get('PG-Api-Version'),'v3');assert.ok(headers.get('PG-Auth-Token'));
  const body=JSON.parse(String(options?.body));
  if(String(url).endsWith('/hosted/create-one-time-hosted-token')) { assert.equal(body.amount,199.99);assert.ok(!body.securityHash);return Response.json({oneTimeToken:'synthetic-token'}); }
  assert.ok(String(url).endsWith('/payment/query'));assert.equal(verifySecurityHash(body,body.securityHash),true);
  const result={success:true,orderId:'test-order',currency:'TRY',amount:199.99,orderStatus:'AUTH',transactions:[{transactionType:'AUTH',transactionStatus:'SUCCESS'}]};
  return Response.json({...result,securityHash:buildSecurityHash(result)});
 };
 const token=await createHostedToken({amount:199.99,orderId:'test-order',successCallbackUrl:'https://example.invalid/result',failCallbackUrl:'https://example.invalid/result',mobilePhoneNumber:'5550000000',data:{currency:'TRY'},locale:'tr'});
 assert.equal(token.oneTimeToken,'synthetic-token');
 const query=await queryPaymentByOrderId({orderId:'test-order',locale:'tr'});assert.equal(verifiedPaymentSuccess(query,'test-order',19999),true);
});
