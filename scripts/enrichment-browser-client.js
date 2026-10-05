// Paste into the developer console of the matching public source origin.
// The localhost bridge address and ephemeral token are supplied by the worker.
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
 while(run.running){
  let job;
  try{job=await rpc('/claim?host='+encodeURIComponent(host));}catch(e){console.log('Bridge paused',String(e));await sleep(5000);continue;}
  if(job.done||job.blocked){run.running=false;console.log('Collector stopped',job);break;}
  if(!job.id){await sleep(Math.min(30000,Math.max(500,job.waitMs||1000)));continue;}
  const started=performance.now();let result={id:job.id,token:job.token,httpStatus:0,elapsedMs:0,bytes:0,retryAfter:null};
  try{
   const response=await fetch(job.path,{signal:AbortSignal.timeout(25000),credentials:'same-origin'});
   result.httpStatus=response.status;result.retryAfter=response.headers.get('retry-after');
   if(!response.ok&&response.headers.get('cf-mitigated')==='challenge')result.error='Source Cloudflare challenge required (HTTP '+response.status+')';
   if(response.ok){
    if(job.kind==='json'){const raw=await response.text();result.bytes=new TextEncoder().encode(raw).length;if(/cf-chl-|checking your browser|security verification|<title>[^<]*(?:attention required|just a moment)/i.test(raw)){result.httpStatus=403;throw Error("Source verification required");}result.body=JSON.parse(raw);}
    else if(job.kind==='html'){const raw=await response.text();result.bytes=new TextEncoder().encode(raw).length;const doc=new DOMParser().parseFromString(raw,'text/html');result.body={logos:[...doc.images].map(i=>i.getAttribute('src')).filter(s=>s&&/\/media\/manufacturer_(cache|source)\//.test(s))};}
    else {
     const blob=await response.blob();if(!blob.type.startsWith('image/')||blob.size>10485760)throw Error('Invalid image response');
     result.bytes=blob.size;
     const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
     const img=new Image();img.src=dataUrl;await img.decode();
     if(job.kind==='logo'){const scale=Math.min(1,360/img.naturalWidth,180/img.naturalHeight);const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);result.body={dataUrl:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height};}
     else result.body={dataUrl,width:img.naturalWidth,height:img.naturalHeight};
    }
   }
  }catch(e){result.error=String(e);}
  result.elapsedMs=Math.round(performance.now()-started);
  // Keep the result in memory until acknowledgement; DB lease expiry handles a lost tab.
  while(run.running){try{await rpc('/result',result);break;}catch(e){if(e.status>=400&&e.status<500){console.error('Result rejected',String(e));break;}console.log('Result delivery paused',String(e));await sleep(5000);}}
  run.requests++;console.log('Enrichment source',host,run.requests,job.path,result.httpStatus);
 }
 return {requests:run.requests};
}
