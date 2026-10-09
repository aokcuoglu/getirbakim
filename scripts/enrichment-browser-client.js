// Paste into the developer console of the matching public source origin.
// The localhost bridge address and ephemeral token are supplied by the worker.
// `fetchSourceJob` is also evaluated directly in the tab by the Chrome driver (enrichment:run -- RUN_ID --chrome).
async function fetchSourceJob(job) {
 const CHALLENGE_TEXT=/cf-chl-|checking your browser|security verification|<title>[^<]*(?:attention required|just a moment)/i;
 const started=performance.now();const result={httpStatus:0,elapsedMs:0,bytes:0,retryAfter:null};
 try{
  const response=await fetch(job.path,{signal:AbortSignal.timeout(25000),credentials:'same-origin'});
  result.httpStatus=response.status;result.retryAfter=response.headers.get('retry-after');
  if(!response.ok&&response.headers.get('cf-mitigated')==='challenge'){result.challenge=true;result.error='Source Cloudflare challenge required (HTTP '+response.status+')';}
  if(response.ok){
   if(job.kind==='json'){const raw=await response.text();result.bytes=new TextEncoder().encode(raw).length;if(CHALLENGE_TEXT.test(raw)){result.httpStatus=403;result.challenge=true;throw Error("Source verification required");}result.body=JSON.parse(raw);}
   else if(job.kind==='html'){const raw=await response.text();result.bytes=new TextEncoder().encode(raw).length;if(CHALLENGE_TEXT.test(raw)){result.httpStatus=403;result.challenge=true;throw Error("Source verification required");}const doc=new DOMParser().parseFromString(raw,'text/html');result.body={logos:[...doc.images].map(i=>i.getAttribute('src')).filter(s=>s&&/\/media\/manufacturer_(cache|source)\//.test(s))};}
   else {
    const blob=await response.blob();if(!blob.type.startsWith('image/')||blob.size>10485760)throw Error('Invalid image response');
    result.bytes=blob.size;
    const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
    // createImageBitmap also decodes in background tabs, where img.decode() can stall; it cannot read SVG logos.
    let img;
    if(blob.type==='image/svg+xml'){
     const url=URL.createObjectURL(blob),el=new Image();
     try{await new Promise((ok,fail)=>{el.onload=ok;el.onerror=()=>fail(Error('SVG could not be loaded'));el.src=url;setTimeout(()=>fail(Error('SVG load timeout')),15000);});}finally{URL.revokeObjectURL(url);}
     img={width:el.naturalWidth||360,height:el.naturalHeight||180,source:el,close(){}};
    }else{const bitmap=await createImageBitmap(blob);img={width:bitmap.width,height:bitmap.height,source:bitmap,close:()=>bitmap.close()};}
    if(job.kind==='logo'){const scale=Math.min(1,360/img.width,180/img.height);const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img.source,0,0,canvas.width,canvas.height);result.body={dataUrl:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height};}
    else result.body={dataUrl,width:img.width,height:img.height};
    img.close();
   }
  }
 }catch(e){result.error=String(e);}
 result.elapsedMs=Math.round(performance.now()-started);
 return result;
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function startEnrichmentBrowser(bridge,token) {
 const host=location.hostname;
 if(!['www.trodo.com','picdn.trodo.com'].includes(host))throw Error('Wrong source origin');
 if(window.__getirbakimCollector)window.__getirbakimCollector.running=false;
 const run=window.__getirbakimCollector={running:true,requests:0,startedAt:new Date().toISOString()};
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function rpc(path,body){
  const response=await fetch(bridge+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000),credentials:'omit'});
  if(!response.ok){const error=new Error('Bridge HTTP '+response.status);error.status=response.status;throw error;}return response.json();
 }
 // Starting the script after the page loaded means the browser check was passed.
 await rpc('/cleared?host='+encodeURIComponent(host)).catch(e=>console.log('Bridge paused',String(e)));
 while(run.running){
  let job;
  try{job=await rpc('/claim?host='+encodeURIComponent(host));}catch(e){console.log('Bridge paused',String(e));await sleep(5000);continue;}
  if(job.challenge){run.running=false;console.log('Cloudflare doğrulaması gerekiyor: sayfayı yenileyin, doğrulamayı geçin ve betiği yeniden çalıştırın.');break;}
  if(job.done||job.blocked){run.running=false;console.log('Collector stopped',job);break;}
  if(!job.id){await sleep(Math.min(30000,Math.max(500,job.waitMs||1000)));continue;}
  const result={id:job.id,token:job.token,...await fetchSourceJob(job)};
  // Keep the result in memory until acknowledgement; DB lease expiry handles a lost tab.
  while(run.running){try{await rpc('/result',result);break;}catch(e){if(e.status>=400&&e.status<500){console.error('Result rejected',String(e));break;}console.log('Result delivery paused',String(e));await sleep(5000);}}
  run.requests++;console.log('Enrichment source',host,run.requests,job.path,result.httpStatus);
 }
 return {requests:run.requests};
}
