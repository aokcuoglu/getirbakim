async function categoryImageCollector(bridge,token){
 if(location.hostname!=='www.trodo.com')throw Error('Wrong category image origin');
 if(window.__getirbakimCategoryImages)window.__getirbakimCategoryImages.running=false;
 const state=window.__getirbakimCategoryImages={running:true,completed:0};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const rpc=async(path,body)=>{const r=await fetch(bridge+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error('Category bridge '+r.status);return r.json();};
 while(state.running){
  let job;try{job=await rpc('/claim');}catch(e){console.log('Category bridge paused',String(e));await sleep(5000);continue;}
  if(job.done){state.running=false;console.log('CATEGORY_IMAGES_DONE',state.completed);break;}
  if(job.blocked){state.running=false;console.log('CATEGORY_IMAGES_BLOCKED');break;}
  if(!job.token){await sleep(job.waitMs||1000);continue;}
  let result={id:job.id,token:job.token,status:0,data:null};
  try{const r=await fetch(job.path,{credentials:'same-origin',signal:AbortSignal.timeout(25000)});result.status=r.status;if(r.ok){const b=await r.blob();if(!b.type.startsWith('image/')||b.size>5000000)throw Error('Invalid category image');result.data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(b);});}}catch(e){result.status=0;result.error=String(e);}
  while(state.running){try{await rpc('/result',result);break;}catch(e){console.log('Category delivery paused',String(e));await sleep(5000);}}
  state.completed++;console.log('CATEGORY_IMAGE',job.id,result.status);await sleep(1000);
 }
}
