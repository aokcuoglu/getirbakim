import type {Pool} from 'pg';
export type FallbackSource='otoparcasan'|'spareto'|'parts2world';
export type AttemptOutcome='found'|'not_found'|'error'|'blocked';
/** Records one product search for the admin page; a failed write is logged and never stops a run. */
export async function recordAttempt(pool:Pool,source:FallbackSource,queue:string,supplierItemId:string,outcome:AttemptOutcome){
 await pool.query('INSERT INTO enrichment_source_attempts(source,queue,supplier_item_id,outcome) VALUES($1,$2,$3,$4)',[source,queue,supplierItemId,outcome])
  .catch(error=>console.error('Arama kaydı yazılamadı:',String(error)));
}
export type RunOutcome='complete'|'blocked'|'stopped'|'failed';
/** Records the start of a run over a fixed queue for the admin page's progress (#403) and returns the call that closes
 *  it. An earlier run of the source left open (its process was killed) is closed as stopped. Failures are logged only. */
export async function startSourceRun(pool:Pool,source:FallbackSource,queue:string,total:number){
 const id=await pool.query<{id:string}>(`WITH closed AS (UPDATE enrichment_source_runs SET finished_at=now(),outcome='stopped' WHERE source=$1 AND finished_at IS NULL)
  INSERT INTO enrichment_source_runs(source,queue,total) VALUES($1,$2,$3) RETURNING id`,[source,queue,total]).then(r=>r.rows[0].id)
  .catch(error=>{console.error('Koşu kaydı yazılamadı:',String(error));return null;});
 return async(outcome:RunOutcome)=>{if(id)await pool.query('UPDATE enrichment_source_runs SET finished_at=now(),outcome=$2 WHERE id=$1',[id,outcome])
  .catch(error=>console.error('Koşu kaydı kapatılamadı:',String(error)));};
}
