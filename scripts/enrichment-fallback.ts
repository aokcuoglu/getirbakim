// One pass of the fallback sources for products the Trodo worker could not find: otoparcasan.com first, then
// spareto.com, each for jobs that are not_found or review, then photos for partial products without one (both
// sources, image only). The collectors skip products they already tried and
// products another source has meanwhile enriched, so a scheduled pass only searches new misses.
// A step that fails (a blocked source, a database outage) is reported and the next step still runs.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const steps:[string,string,string][]=[
 ['otoparcasan','scripts/otoparcasan-enrichment.ts','not_found'],['otoparcasan','scripts/otoparcasan-enrichment.ts','review'],
 ['spareto','scripts/spareto-enrichment.ts','not_found'],['spareto','scripts/spareto-enrichment.ts','review'],
 ['image-fill','scripts/enrichment-image-fill.ts','partial'],
];
const limit=process.env.ENRICHMENT_FALLBACK_LIMIT||'1000';
console.log(JSON.stringify({fallback:'start',at:new Date().toISOString()}));
let failed=0;
for(const [source,script,status] of steps){
 const started=Date.now();
 // The collectors read .env.local themselves through the parent's --env-file; the environment is passed through.
 const run=spawnSync(process.execPath,['--conditions=react-server','--import','tsx',resolve(root,script),'collect','--status',status,'--limit',limit],
  {cwd:root,env:process.env,stdio:'inherit'});
 if(run.status!==0)failed++;
 console.log(JSON.stringify({fallback:'step',source,status,exit:run.status,signal:run.signal,seconds:Math.round((Date.now()-started)/1000)}));
}
console.log(JSON.stringify({fallback:'done',failed,at:new Date().toISOString()}));
process.exitCode=failed?1:0;
