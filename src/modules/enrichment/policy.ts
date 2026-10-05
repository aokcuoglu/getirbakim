export const SOURCE_HOSTS = ['www.trodo.com','picdn.trodo.com'] as const;
export type SourceHost = typeof SOURCE_HOSTS[number];
export function validSourcePath(host:string,path:string,kind:string) {
 if(path.length>2000 || !path.startsWith('/') || path.startsWith('//') || /[\r\n\\]/.test(path)) return false;
 if(host==='picdn.trodo.com') return kind==='image' && /^\/media\/m2_catalog_cache\/(?:480|1440)x(?:480|1440)/.test(path);
 if(host!=='www.trodo.com') return false;
 if(kind==='json') return /^\/rest\/V1\/(?:catalogsearch\/result\/0\?|catalog-product-api\/(?:product-url\/[^/]+\/IE|view-data\/\d+\/IE)$|vehicle\/(?:models|type)\/1\/\d+$)/.test(path);
 if(kind==='logo') return /^\/media\/manufacturer_(?:source|cache)\/\d+\//.test(path);
 return kind==='html' && /^\/[a-z0-9][a-z0-9-]+$/.test(path);
}
export function retryAfterMs(value:string|null,now=Date.now()) {
 if(!value) return 0;
 const seconds=Number(value);
 if(Number.isFinite(seconds)&&seconds>=0) return seconds*1000;
 const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):0;
}
export function sourceDecision(status:number,attempt:number,retryAfter:string|null,now=Date.now()) {
 if([401,403].includes(status)) return {action:'block' as const,waitMs:0};
 if(status===429 || status===503 || status===0 || status>=500) {
  return {action:attempt>=4?'block' as const:'retry' as const,waitMs:Math.max(retryAfterMs(retryAfter,now),Math.min(900000,60000*2**(attempt-1)))};
 }
 return {action:status>=200&&status<300?'complete' as const:'fail' as const,waitMs:0};
}
export function cacheLifetime(path:string,kind:string) {
 if(kind==='image'||kind==='logo')return 90*86400000;
 if(/\/vehicle\//.test(path))return 30*86400000;
 return /catalogsearch/.test(path)?86400000:7*86400000;
}
