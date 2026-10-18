import type {Pool} from 'pg';
export type FallbackSource='otoparcasan'|'spareto';
export type AttemptOutcome='found'|'not_found'|'error'|'blocked';
/** Records one product search for the admin page; a failed write is logged and never stops a run. */
export async function recordAttempt(pool:Pool,source:FallbackSource,queue:string,supplierItemId:string,outcome:AttemptOutcome){
 await pool.query('INSERT INTO enrichment_source_attempts(source,queue,supplier_item_id,outcome) VALUES($1,$2,$3,$4)',[source,queue,supplierItemId,outcome])
  .catch(error=>console.error('Arama kaydı yazılamadı:',String(error)));
}
