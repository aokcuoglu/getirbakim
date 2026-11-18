import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {parts2worldLockNames} from '../src/modules/enrichment/parts2world-locks';
import {Parts2WorldClient} from '../src/modules/enrichment/parts2world-client';
import {EgressProxyError,parseEgressProxy} from '../src/modules/suppliers/egress-proxy';

test('lock names: direct keeps the old names, proxy gets its own',()=>{
 assert.deepEqual(parts2worldLockNames('direct'),{run:'parts2world-collect',source:'parts2world-source'});
 assert.deepEqual(parts2worldLockNames('proxy'),{run:'parts2world-collect:proxy',source:'parts2world-source:proxy'});
 assert.notEqual(parts2worldLockNames('direct').run,parts2worldLockNames('proxy').run);
});

test('parseEgressProxy: empty is undefined, strict URL, credentials become Basic',()=>{
 assert.equal(parseEgressProxy(undefined),undefined);
 assert.equal(parseEgressProxy('  '),undefined);
 const proxy=parseEgressProxy('http://u:p@127.0.0.1:13128');
 assert.deepEqual(proxy,{url:'http://127.0.0.1:13128',host:'127.0.0.1',port:13128,authorization:'Basic '+Buffer.from('u:p').toString('base64')});
 for(const bad of['not a url','https://proxy:3128','http://proxy','http://u@proxy:3128','http://proxy:3128/x'])assert.throws(()=>parseEgressProxy(bad),EgressProxyError,bad);
});

test('client preflight: tunnels to www.parts2world.com:443 with credentials; a refused CONNECT fails clearly; direct is a no-op',async()=>{
 const seen:{target:string;authorization?:string}[]=[];
 let status=200;
 const server:Server=createServer();
 server.on('connect',(req,client)=>{
  seen.push({target:req.url??'',authorization:req.headers['proxy-authorization']});
  client.end(`HTTP/1.1 ${status} X\r\n\r\n`);
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',()=>r()));
 try{
  const proxy=parseEgressProxy(`http://u:p@127.0.0.1:${(server.address() as AddressInfo).port}`)!;
  await new Parts2WorldClient(0,0).preflight();
  assert.equal(seen.length,0);
  await new Parts2WorldClient(0,0,proxy).preflight();
  assert.deepEqual(seen,[{target:'www.parts2world.com:443',authorization:proxy.authorization}]);
  status=403;
  await assert.rejects(new Parts2WorldClient(0,0,proxy).preflight(),/CONNECT HTTP 403/);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
