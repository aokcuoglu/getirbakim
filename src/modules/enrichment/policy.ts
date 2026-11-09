export const SOURCE_HOSTS = ['www.trodo.com','picdn.trodo.com'] as const;
export type SourceHost = typeof SOURCE_HOSTS[number];
export function validSourcePath(host:string,path:string,kind:string) {
 if(path.length>2000 || !path.startsWith('/') || path.startsWith('//') || /[\r\n\\]/.test(path)) return false;
 if(host==='picdn.trodo.com') return kind==='image' && /^\/media\/m2_catalog_cache\/(?:480|1440)x(?:480|1440)/.test(path);
 if(host!=='www.trodo.com') return false;
 if(kind==='json') return /^\/rest\/V1\/(?:catalogsearch\/(?:result\/0|oem\/[A-Z0-9]{1,60})\?|catalog-product-api\/(?:product-url\/[^/]+\/IE|view-data\/\d+\/IE)$|vehicle\/(?:models|type)\/1\/\d+$|catalog-category-products\/engine-oil\/no-filter\/\d+\/[a-z0-9-]+-cid\?is_ajax=true&customer_group_id=undefined$)/.test(path);
 if(kind==='logo') return /^\/media\/manufacturer_(?:source|cache)\/\d+\//.test(path);
 return kind==='html' && /^\/[a-z0-9][a-z0-9-]+$/.test(path);
}
export function retryAfterMs(value:string|null,now=Date.now()) {
 if(!value) return 0;
 const seconds=Number(value);
 if(Number.isFinite(seconds)&&seconds>=0) return seconds*1000;
 const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):0;
}
export function sourceDecision(status:number,attempt:number,retryAfter:string|null,now=Date.now(),challenge=false) {
 // A Cloudflare browser check is cleared by revisiting the site, not by retrying the request.
 if(challenge&&[403,429,503].includes(status)) return {action:'challenge' as const,waitMs:0};
 if([401,403].includes(status)) return {action:'block' as const,waitMs:0};
 // No response at all is local (the Mac slept or the network changed), not the source refusing us: keep retrying
 // across a sleep without opening the host circuit, and give up on this request alone if it never loads.
 if(status===0) return {action:attempt>=12?'fail' as const:'retry' as const,waitMs:Math.min(900000,60000*2**(attempt-1))};
 if(status===429 || status===503 || status>=500) {
  return {action:attempt>=4?'block' as const:'retry' as const,waitMs:Math.max(retryAfterMs(retryAfter,now),Math.min(900000,60000*2**(attempt-1)))};
 }
 return {action:status>=200&&status<300?'complete' as const:'fail' as const,waitMs:0};
}
export function cacheLifetime(path:string,kind:string) {
 if(kind==='image'||kind==='logo')return 90*86400000;
 if(/\/vehicle\//.test(path))return 30*86400000;
 return /catalogsearch/.test(path)?86400000:7*86400000;
}
// Milliseconds until a nightly quiet window ends, or 0 outside it. Hours are local to `timeZone`; a window whose
// start is after its end crosses midnight, and equal or missing hours mean no window.
export function quietWaitMs(now:number,startHour:number|null,endHour:number|null,timeZone='Europe/Istanbul') {
 if(startHour==null||endHour==null||startHour===endHour) return 0;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone,hourCycle:'h23',hour:'numeric',minute:'numeric',second:'numeric'}).formatToParts(now).map(p=>[p.type,Number(p.value)]));
 const minute=parts.hour*60+parts.minute,start=startHour*60,end=endHour*60;
 const inside=start<end?minute>=start&&minute<end:minute>=start||minute<end;
 if(!inside) return 0;
 const left=(end-minute+1440)%1440||1440;
 return left*60000-parts.second*1000-now%1000;
}
// Delay before the next request: the host interval plus a random share of its jitter.
export function pacingDelayMs(intervalMs:number,jitterMs:number,random=Math.random) {
 return intervalMs+Math.floor(random()*Math.max(0,jitterMs));
}
