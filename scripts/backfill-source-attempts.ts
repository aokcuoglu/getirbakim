// One-time import of otoparcasan.com and spareto.com searches recorded before enrichment_source_attempts existed (#307),
// so the admin page knows which sources already searched each product.
//   [otoparcasan|spareto file.jsonl ...]   default: the standard checkpoints under artifacts/
// Lines newer than the source's first live attempt are already in the table; a rerun inserts nothing twice.
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});
const defaults:[string,string[]][]=[['otoparcasan',['artifacts/otoparcasan/results.jsonl','artifacts/otoparcasan/results-nf-new.jsonl',
 'artifacts/otoparcasan/results-nf-recheck.jsonl','artifacts/otoparcasan/results-review-jobs.jsonl']],['spareto',['artifacts/spareto/results.jsonl']]];
const [source,...files]=process.argv.slice(2);
if(source&&!['otoparcasan','spareto'].includes(source))throw Error('Usage: backfill-source-attempts.ts [otoparcasan|spareto file.jsonl ...]');
const outcomes:Record<string,string>={collected:'found',not_found:'not_found',error:'error'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
try{
 for(const [name,paths] of source?[[source,files] as [string,string[]]]:defaults){
  const rows:{supplier_item_id:string;outcome:string;attempted_at:string}[]=[];
  for(const path of paths){
   let text:string;try{text=await readFile(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
   for(const line of text.split('\n'))if(line.trim()){
    const entry=JSON.parse(line) as {supplierItemId?:string;outcome?:string;at?:string};
    if(entry.supplierItemId&&uuid.test(entry.supplierItemId)&&entry.at&&outcomes[entry.outcome||''])rows.push({supplier_item_id:entry.supplierItemId,outcome:outcomes[entry.outcome!],attempted_at:entry.at});
   }
  }
  const inserted=await pool.query(`INSERT INTO enrichment_source_attempts(source,queue,supplier_item_id,outcome,attempted_at)
   SELECT $1,NULL,r.supplier_item_id,r.outcome,r.attempted_at FROM jsonb_to_recordset($2::jsonb) AS r(supplier_item_id uuid,outcome text,attempted_at timestamptz)
   WHERE r.attempted_at<COALESCE((SELECT min(attempted_at) FROM enrichment_source_attempts WHERE source=$1 AND queue IS NOT NULL),'infinity')
    AND NOT EXISTS(SELECT 1 FROM enrichment_source_attempts a WHERE a.source=$1 AND a.supplier_item_id=r.supplier_item_id AND a.attempted_at=r.attempted_at)`,[name,JSON.stringify(rows)]);
  console.log(JSON.stringify({source:name,read:rows.length,inserted:inserted.rowCount}));
 }
}finally{await pool.end();}
