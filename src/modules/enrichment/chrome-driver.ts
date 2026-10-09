import {spawn,execFile} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import type {SourceQueue} from './source-queue';

// Drives a dedicated, normal (non-automation-flagged) Chrome profile over CDP at the same queue rate limits.
// Searches and product data are read the way a visitor gets them: the driver opens the search results page or the
// product page and reads the API responses that page itself loads. Vehicle lists and images are fetched in the tab.
// A Cloudflare browser check pauses the host until the site loads normally again (by itself or by the operator).
const CHROME=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

type CdpEvent={method:string;params:any};// eslint-disable-line @typescript-eslint/no-explicit-any
class CdpPage {
 private next=1;private pending=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void}>();
 listeners=new Set<(event:CdpEvent)=>void>();
 private constructor(private ws:WebSocket){
  ws.addEventListener('message',event=>{
   const message=JSON.parse(String(event.data));
   if(message.method){for(const l of this.listeners)l(message);return;}
   const waiter=this.pending.get(message.id);if(!waiter)return;
   this.pending.delete(message.id);
   if(message.error)waiter.reject(Error(message.error.message));else waiter.resolve(message.result);
  });
  ws.addEventListener('close',()=>{for(const w of this.pending.values())w.reject(Error('CDP connection closed'));this.pending.clear();});
 }
 static async connect(url:string){
  const ws=new WebSocket(url);
  await new Promise<void>((resolve,reject)=>{ws.addEventListener('open',()=>resolve(),{once:true});ws.addEventListener('error',()=>reject(Error('CDP connect failed')),{once:true});});
  return new CdpPage(ws);
 }
 get open(){return this.ws.readyState===WebSocket.OPEN;}
 send(method:string,params:Record<string,unknown>={},timeoutMs=60000):Promise<any>{// eslint-disable-line @typescript-eslint/no-explicit-any
  const id=this.next++;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('CDP timeout: '+method));},timeoutMs);
   this.pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
   this.ws.send(JSON.stringify({id,method,params}));
  });
 }
 // Runtime.enable is deliberately never called; evaluate works without it.
 async evaluate<T>(expression:string,timeoutMs=60000):Promise<T>{
  const r=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},timeoutMs);
  if(r.exceptionDetails)throw Error('Page evaluation failed: '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text));
  return r.result.value as T;
 }
 navigate(url:string){return this.send('Page.navigate',{url});}
 close(){this.ws.close();}
 // Opens a document and returns the bodies of the API responses that the page itself requested.
 async visit(url:string,wanted:Record<string,RegExp>,required:string[],timeoutMs=30000){
  const seen=new Map<string,{url:string;status:number;challenge:boolean}>(),found:Record<string,{url:string;status:number;challenge:boolean;body:string}>={};
  const reads:Promise<void>[]=[];let wake=()=>{};
  const listener=(e:CdpEvent)=>{
   if(e.method==='Network.responseReceived'){
    const h=e.params.response.headers||{};
    seen.set(e.params.requestId,{url:e.params.response.url,status:e.params.response.status,challenge:(h['cf-mitigated']||h['Cf-Mitigated'])==='challenge'});
   }else if(e.method==='Network.loadingFinished'){
    const r=seen.get(e.params.requestId);if(!r)return;
    // The site retries a challenged search itself after its in-page Turnstile check; a later 200 replaces the 403.
    const key=Object.keys(wanted).find(k=>found[k]?.status!==200&&wanted[k].test(r.url));if(!key)return;
    reads.push(this.send('Network.getResponseBody',{requestId:e.params.requestId}).then(b=>{
     if(found[key]?.status!==200)found[key]={url:r.url,status:r.status,challenge:r.challenge,body:b.base64Encoded?Buffer.from(b.body,'base64').toString():b.body};wake();
    },()=>{}));
   }
  };
  this.listeners.add(listener);
  try{
   await this.navigate(url);
   const deadline=Date.now()+timeoutMs;
   while(Date.now()<deadline&&!required.every(k=>found[k]?.status===200)){await new Promise<void>(r=>{wake=r;setTimeout(r,500);});}
   // Optional responses usually arrive together with the required ones.
   if(Object.keys(wanted).some(k=>!found[k]))await new Promise(r=>setTimeout(r,2500));
   await Promise.allSettled(reads);
   return found;
  }finally{this.listeners.delete(listener);}
 }
}

type Target={id:string;type:string;url:string;webSocketDebuggerUrl?:string};
async function targets(port:number):Promise<Target[]>{return (await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(3000)})).json();}

export async function ensureChrome(port:number,profileDir:string,startUrl:string){
 const up=async()=>{try{await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(2000)});return true;}catch{return false;}};
 if(await up())return;
 await mkdir(profileDir,{recursive:true});
 // Detached so the browser session (and its clearance cookies) outlives worker restarts.
 spawn(CHROME,[`--remote-debugging-port=${port}`,`--user-data-dir=${profileDir}`,'--no-first-run','--no-default-browser-check',
  '--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows',startUrl],{detached:true,stdio:'ignore'}).unref();
 for(let i=0;i<60;i++){if(await up())return;await sleep(500);}
 throw Error('Chrome DevTools endpoint did not start on port '+port);
}

async function pageFor(port:number,host:string,landingUrl:string){
 let target=(await targets(port)).find(t=>t.type==='page'&&URL.canParse(t.url)&&new URL(t.url).hostname===host);
 if(!target){
  target=await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(landingUrl)}`,{method:'PUT'})).json() as Target;
 }
 if(!target.webSocketDebuggerUrl)throw Error('Source tab is already attached to another DevTools client: '+host);
 return CdpPage.connect(target.webSocketDebuggerUrl);
}

const PAGE_STATE=`(()=>({ready:document.readyState,host:location.hostname,title:document.title,
 blocked:/you have been blocked|unable to access/i.test(document.body?.innerText||''),
 challenge:/just a moment|attention required|bir dakika|security verification|güvenlik doğrulaması/i.test(document.title)
  ||Boolean(window._cf_chl_opt||document.querySelector('#challenge-form,#challenge-running,#cf-challenge-running'))}))()`;
// Not .cf-turnstile: the regular Trodo homepage embeds a Turnstile widget in its forms.

function notify(message:string){
 console.log(JSON.stringify({chrome:'action_required',message}));
 if(process.platform==='darwin')execFile('osascript',['-e',`display notification ${JSON.stringify(message)} with title "getirbakim veri çekme" sound name "Glass"`],()=>{});
}

const SITE='https://www.trodo.com';
const SEARCH_API=/\/rest\/V1\/catalogsearch\/result\/0\?/;
const OEM_API=/\/rest\/V1\/catalogsearch\/oem\/([A-Z0-9]+)\?/;
const PRODUCT_API=/\/rest\/V1\/catalog-product-api\/product-url\/[^/?]+\/IE(?:\?|$)/;
const VIEW_API=/\/rest\/V1\/catalog-product-api\/view-data\/(\d+)\/IE(?:\?|$)/;
const LOGOS=`[...document.images].map(i=>i.getAttribute('src')).filter(s=>s&&/\\/media\\/manufacturer_(cache|source)\\//.test(s))`;
type SourceResult={httpStatus:number;elapsedMs:number;bytes:number;retryAfter:string|null;error?:string;challenge?:boolean;body?:unknown};

export type ChromeCollectorOptions={port:number;profileDir:string;clientCode:string;landing:Record<string,string>;
 challengeTimeoutMs?:number;log?:(event:Record<string,unknown>)=>void};

export function startChromeCollectors(queue:SourceQueue,options:ChromeCollectorOptions){
 const state={stopped:false,wake:()=>{}};const log=options.log||(e=>console.log(JSON.stringify(e)));
 const challengeTimeoutMs=options.challengeTimeoutMs??45*60000;
 // Waits that end early when the collectors are stopped.
 const pause=(ms:number)=>new Promise<void>(r=>{const t=setTimeout(r,ms);const prev=state.wake;state.wake=()=>{clearTimeout(t);prev();r();};});
 const pages=new Map<string,CdpPage>();
 async function collect(host:string){
  const landing=options.landing[host];
  let page:CdpPage|undefined;
  const connect=async()=>{page?.close();page=await pageFor(options.port,host,landing);pages.set(host,page);if(host==='www.trodo.com')await page.send('Network.enable',{});return page;};
  // view-data responses loaded by a product page, served when the worker asks for them next.
  const views=new Map<string,SourceResult>();
  async function run(job:{path:string;kind:string}):Promise<SourceResult>{
   const started=Date.now(),p=page!;
   const fromPage=async(url:string,wanted:Record<string,RegExp>,key:string):Promise<SourceResult>=>{
    const found=await p.visit(url,wanted,[key]);
    const view=found.view;
    if(view?.status===200){try{const body=JSON.parse(view.body);const id=VIEW_API.exec(view.url)?.[1];if(id)views.set(`/rest/V1/catalog-product-api/view-data/${id}/IE`,{httpStatus:200,elapsedMs:0,bytes:view.body.length,retryAfter:null,body});}catch{/* fetched again on demand */}}
    const hit=found[key];
    if(!hit){
     const s=await p.evaluate<{blocked:boolean;challenge:boolean;title:string}>(PAGE_STATE,10000).catch(()=>null);
     if(s?.blocked)return {httpStatus:403,elapsedMs:Date.now()-started,bytes:0,retryAfter:null,error:'Cloudflare block page: '+s.title};
     if(s?.challenge)return {httpStatus:403,elapsedMs:Date.now()-started,bytes:0,retryAfter:null,challenge:true,error:'Source Cloudflare challenge page'};
     return {httpStatus:0,elapsedMs:Date.now()-started,bytes:0,retryAfter:null,error:'Page did not load the source data: '+url};
    }
    const result:SourceResult={httpStatus:hit.status,elapsedMs:Date.now()-started,bytes:Buffer.byteLength(hit.body),retryAfter:null,challenge:hit.challenge||undefined};
    if(hit.status===200){try{result.body=JSON.parse(hit.body);}catch{result.error='Source response is not JSON';result.httpStatus=0;}}
    else if(hit.challenge)result.error='Source Cloudflare challenge required (HTTP '+hit.status+')';
    return result;
   };
   if(host==='www.trodo.com'&&job.kind==='json'&&SEARCH_API.test(job.path)){
    const q=new URL(job.path,SITE).searchParams.get('q')||'';
    return fromPage(`${SITE}/catalogsearch/result?q=${encodeURIComponent(q)}&searchby=name`,{search:SEARCH_API},'search');
   }
   const oem=OEM_API.exec(job.path);
   if(host==='www.trodo.com'&&job.kind==='json'&&oem)return fromPage(`${SITE}/catalogsearch/oem/${oem[1]}`,{search:OEM_API},'search');
   const product=/^\/rest\/V1\/catalog-product-api\/product-url\/([^/]+)\/IE$/.exec(job.path);
   if(host==='www.trodo.com'&&job.kind==='json'&&product){
    return fromPage(`${SITE}/${decodeURIComponent(product[1])}`,{product:PRODUCT_API,view:VIEW_API},'product');
   }
   const cachedView=views.get(job.path);if(cachedView){views.delete(job.path);return {...cachedView,elapsedMs:0};}
   if(host==='www.trodo.com'&&job.kind==='html'){
    const here=await p.evaluate<string>('location.pathname',10000);
    if(here!==job.path){await p.navigate(SITE+job.path);await pause(6000);}
    const s=await p.evaluate<{blocked:boolean;challenge:boolean;title:string}>(PAGE_STATE,10000);
    if(s.blocked||s.challenge)return {httpStatus:403,elapsedMs:Date.now()-started,bytes:0,retryAfter:null,challenge:s.challenge||undefined,error:'Cloudflare page: '+s.title};
    return {httpStatus:200,elapsedMs:Date.now()-started,bytes:0,retryAfter:null,body:{logos:await p.evaluate<string[]>(LOGOS,10000)}};
   }
   // Same query string the product page uses for this endpoint.
   const path=VIEW_API.test(job.path)?job.path+'?currency=EUR':job.path;
   return p.evaluate<SourceResult>(`(async()=>{${options.clientCode}\nreturn await fetchSourceJob(${JSON.stringify({path,kind:job.kind})});})()`,45000);
  }
  // Waits until the tab shows the real site; the operator may need to tick a Turnstile box.
  async function clear(reason:string,url=landing){
   const started=Date.now();let notified=false;
   log({chrome:'clearing',host,reason,url});
   try{await (page?.open?page:await connect()).navigate(url);}catch{await connect();await page!.navigate(url);}
   while(!state.stopped){
    await pause(3000);
    let s:{ready:string;host:string;title:string;challenge:boolean;blocked:boolean};
    try{s=await page!.evaluate(PAGE_STATE,10000);}catch{try{await connect();}catch{/* tab reopening */}continue;}
    // A Cloudflare block page is a decision, not a check to pass: stop instead of retrying.
    if(s.blocked){await queue.blockHost(host,'Cloudflare block page: '+s.title);log({chrome:'blocked',host,title:s.title});return false;}
    if(s.host===host&&s.ready==='complete'&&!s.challenge){
     await pause(2000);log({chrome:'cleared',host,waitedMs:Date.now()-started});
     return true;
    }
    if(!notified&&Date.now()-started>20000){notified=true;notify(`Chrome'daki ${host} sekmesinde Cloudflare doğrulamasını tamamlayın; işlem kendiliğinden devam edecek.`);}
    if(Date.now()-started>challengeTimeoutMs){await queue.blockHost(host,'Cloudflare challenge not cleared within '+Math.round(challengeTimeoutMs/60000)+' minutes');log({chrome:'blocked',host});return false;}
   }
   return false;
  }
  let lastCleared=0,successes=0,recoveries=0;
  while(!state.stopped)try{
   await ensureChrome(options.port,options.profileDir,landing);
   await connect();
   if(!(await clear('startup')))return;
   await queue.clearChallenge(host);lastCleared=Date.now();
   while(!state.stopped){
    const host_=await queue.hostState(host);
    if(host_.blocked){log({chrome:'host_blocked',host,error:host_.lastError});return;}
    if(host_.challengeSince){
     // Repeated challenges right after a reload without any success: back off before revisiting.
     if(successes===0&&Date.now()-lastCleared<120000){recoveries++;const wait=Math.min(15*60000,60000*2**(recoveries-1));log({chrome:'challenge_backoff',host,waitMs:wait});await pause(wait);}
     else recoveries=0;
     if(state.stopped||!(await clear('challenge')))return;
     await queue.clearChallenge(host);lastCleared=Date.now();successes=0;continue;
    }
    const job=await queue.claim(host);
    if('blocked' in job){log({chrome:'host_blocked',host});return;}
    if('challenge' in job)continue;
    if('waitMs' in job){await pause(Math.min(5000,Math.max(250,job.waitMs)));continue;}
    let result:SourceResult;
    try{
     if(!page?.open)await connect();
     result=await run(job);
     if(/Cloudflare block page/.test(result.error||'')){await queue.release(job.id,job.token);await queue.blockHost(host,result.error!);log({chrome:'blocked',host,error:result.error});return;}
    }catch(error){
     // The response never arrived (navigation, closed tab, lost CDP); the request goes back unspent.
     await queue.release(job.id,job.token);log({chrome:'request_interrupted',host,error:String(error)});
     // If the tab cannot be reattached (Chrome closed or crashed), the outer loop relaunches Chrome.
     await pause(3000);await connect();continue;
    }
    const outcome=await queue.finish({...result,id:job.id,token:job.token});
    if(outcome.action==='complete')successes++;
    if(outcome.action!=='complete')log({chrome:'request',host,path:job.path,status:result.httpStatus,action:outcome.action,error:result.error});
   }
  }catch(error){log({chrome:'collector_error',host,error:String(error)});page?.close();page=undefined;await pause(10000);}
  page?.close();
 }
 // An open CDP socket keeps the process alive, so every exit path closes the tab connection.
 const done=Promise.all(Object.keys(options.landing).map(host=>collect(host).finally(()=>pages.get(host)?.close())));
 return {stop(){state.stopped=true;state.wake();return done;},done};
}
