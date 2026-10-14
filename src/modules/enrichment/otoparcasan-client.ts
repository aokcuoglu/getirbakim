import {z} from 'zod';
import {OTOPARCASAN} from './otoparcasan-adapter';
export class SourceBlocked extends Error {}
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const csrfSchema=z.object({token_name:z.string().min(1),token_hash:z.string().min(1)});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
/** Sequential, paced client for otoparcasan.com's public site. Any block/rate-limit answer stops the run. */
export class OtoparcasanClient {
 private cookies=new Map<string,string>();private csrf:z.infer<typeof csrfSchema>|null=null;private last=0;requests=0;
 constructor(readonly intervalMs=1500,readonly jitterMs=750){}
 private async request(path:string,form?:Record<string,string>){
  if(!/^[A-Za-z0-9/_.-]*$/.test(path))throw Error('Source path rejected: '+path);
  const wait=this.last+this.intervalMs+Math.random()*this.jitterMs-Date.now();if(wait>0)await sleep(wait);
  for(let attempt=0;;attempt++){
   this.last=Date.now();this.requests++;
   try{
    const response=await fetch(OTOPARCASAN+path,{method:form?'POST':'GET',redirect:'follow',signal:AbortSignal.timeout(40000),
     headers:{'User-Agent':UA,'Accept-Language':'tr-TR,tr;q=0.9',Referer:OTOPARCASAN,...(form?{'X-Requested-With':'XMLHttpRequest','Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}:{}),
      ...(this.cookies.size?{Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ')}:{})},
     body:form?new URLSearchParams(form).toString():undefined});
    for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';');const at=pair.indexOf('=');if(at>0)this.cookies.set(pair.slice(0,at).trim(),pair.slice(at+1).trim());}
    const body=await response.text();
    if([403,429,503].includes(response.status)||/cf-chl|challenge-platform|Just a moment/i.test(body.slice(0,4000)))throw new SourceBlocked(`otoparcasan.com answered HTTP ${response.status} for ${path}`);
    if(response.status===404)return null;
    if(!response.ok)throw Error(`HTTP ${response.status} for ${path}`);
    return body;
   }catch(error){
    if(error instanceof SourceBlocked||attempt>=1)throw error;
    await sleep(10000);
   }
  }
 }
 async page(slug:string){return this.request(slug);}
 /** POSTs a site AJAX form; the CSRF token rotates with every answer. */
 async post(path:string,form:Record<string,string>):Promise<unknown>{
  for(let attempt=0;;attempt++){
   if(!this.csrf){if(!this.cookies.size)await this.request('');this.csrf=csrfSchema.parse(JSON.parse(await this.request('Ajax/getCsrf/')||'null'));}
   const body=await this.request(path,{...form,[this.csrf.token_name]:this.csrf.token_hash});
   let json:unknown;try{json=JSON.parse(body||'');}catch{json=undefined;}
   const next=csrfSchema.safeParse((json as {csrf?:unknown}|undefined)?.csrf);
   if(next.success)this.csrf=next.data;
   if(json!==undefined)return json;
   // An expired token answers an HTML error page; fetch a fresh one once.
   this.csrf=null;if(attempt>=1)throw Error('Unexpected non-JSON answer for '+path);
  }
 }
}
