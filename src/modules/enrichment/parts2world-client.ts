import {PARTS2WORLD,articleInfoPattern} from './parts2world-adapter';
export class SourceBlocked extends Error {}
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
/** Sequential, paced client for parts2world.com's public TecDoc API. The site answered HTTP 429 at about one request a
 *  second during the #382 measurement, so the default pace is slower and any block or rate-limit answer stops the run
 *  instead of being retried. Answers often take several seconds. */
export class Parts2WorldClient {
 private last=0;requests=0;
 constructor(readonly intervalMs=2500,readonly jitterMs=1000){}
 private async pace(){const wait=this.last+this.intervalMs+Math.random()*this.jitterMs-Date.now();if(wait>0)await sleep(wait);this.last=Date.now();this.requests++;}
 /** One article-info answer; null for 404. */
 async articleInfo(path:string):Promise<unknown|null>{
  if(!articleInfoPattern.test(path))throw Error('Source path rejected: '+path);
  for(let attempt=0;;attempt++){
   await this.pace();
   try{
    const response=await fetch(PARTS2WORLD+path,{redirect:'error',signal:AbortSignal.timeout(90000),
     headers:{'User-Agent':UA,Accept:'application/json, text/plain, */*','Accept-Language':'en',Referer:PARTS2WORLD+'/tecdoc/'}});
    if([403,429,503].includes(response.status)){await response.body?.cancel();throw new SourceBlocked(`parts2world.com answered HTTP ${response.status} for ${path}`);}
    if(response.status===404){await response.body?.cancel();return null;}
    if(!response.ok){await response.body?.cancel();throw Error(`HTTP ${response.status} for ${path}`);}
    return await response.json();
   }catch(error){
    if(error instanceof SourceBlocked||attempt>=1)throw error;
    await sleep(30000);
   }
  }
 }
 /** Downloads a product photo from the site's image path; null when it answers something else. */
 async image(url:string):Promise<Buffer|null>{
  const parsed=new URL(url);
  if(parsed.origin!==PARTS2WORLD||!parsed.pathname.startsWith('/_debug/tecdoc-images/'))throw Error('Image URL rejected: '+url);
  await this.pace();
  const response=await fetch(parsed,{redirect:'error',signal:AbortSignal.timeout(60000),headers:{'User-Agent':UA,Referer:PARTS2WORLD+'/tecdoc/',Accept:'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5'}});
  if([403,429,503].includes(response.status)){await response.body?.cancel();throw new SourceBlocked(`parts2world.com answered HTTP ${response.status} for an image`);}
  const type=response.headers.get('content-type')||'',length=Number(response.headers.get('content-length')||0);
  if(!response.ok||!type.startsWith('image/')||length>10*1024*1024){await response.body?.cancel();return null;}
  const bytes=Buffer.from(await response.arrayBuffer());
  return bytes.length&&bytes.length<=10*1024*1024?bytes:null;
 }
}
