import {SPARETO} from './spareto-adapter';
export class SourceBlocked extends Error {}
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
/** Sequential, paced client for spareto.com's public catalog (robots.txt: Crawl-delay 1). Any block or rate-limit
 *  answer stops the run instead of being retried. */
export class SparetoClient {
 private last=0;requests=0;
 constructor(readonly intervalMs=1500,readonly jitterMs=750){}
 private async pace(){const wait=this.last+this.intervalMs+Math.random()*this.jitterMs-Date.now();if(wait>0)await sleep(wait);this.last=Date.now();this.requests++;}
 /** A search or product page; null for 404. */
 async page(path:string):Promise<string|null>{
  if(!/^\/products(\/[a-z0-9-]+\/[a-z0-9-]+|\?utf8=%E2%9C%93&keywords=[A-Za-z0-9%._~!*'()-]*)$/.test(path))throw Error('Source path rejected: '+path);
  for(let attempt=0;;attempt++){
   await this.pace();
   try{
    const response=await fetch(SPARETO+path,{redirect:'follow',signal:AbortSignal.timeout(40000),headers:{'User-Agent':UA,'Accept-Language':'en',Accept:'text/html'}});
    const body=await response.text();
    if([403,429,503].includes(response.status)||/cf-chl|challenge-platform|Just a moment|Attention Required/i.test(body.slice(0,4000)))throw new SourceBlocked(`spareto.com answered HTTP ${response.status} for ${path}`);
    if(response.status===404)return null;
    if(!response.ok)throw Error(`HTTP ${response.status} for ${path}`);
    return body;
   }catch(error){
    if(error instanceof SourceBlocked||attempt>=1)throw error;
    await sleep(10000);
   }
  }
 }
 /** Downloads a product photo from the site's CDN; null when it answers something else. */
 async image(url:string):Promise<Buffer|null>{
  const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!=='cdn.spareto.com')throw Error('Image host rejected: '+url);
  await this.pace();
  const response=await fetch(parsed,{redirect:'error',signal:AbortSignal.timeout(40000),headers:{'User-Agent':UA,Referer:SPARETO+'/',Accept:'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5'}});
  if([403,429,503].includes(response.status))throw new SourceBlocked(`cdn.spareto.com answered HTTP ${response.status}`);
  const type=response.headers.get('content-type')||'',length=Number(response.headers.get('content-length')||0);
  if(!response.ok||!type.startsWith('image/')||length>10*1024*1024){await response.body?.cancel();return null;}
  const bytes=Buffer.from(await response.arrayBuffer());
  return bytes.length&&bytes.length<=10*1024*1024?bytes:null;
 }
}
