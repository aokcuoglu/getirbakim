import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {cacheLifetime,sourceDecision,validSourcePath} from './policy';
export class SourceBlocked extends Error {}
export class WorkerStopped extends Error {}
export class SourceQueue {
 stopping=false;
 constructor(readonly pool:Pool,readonly runId:string){}
 async get(host:string,path:string,kind='json'):Promise<unknown>{
  if(!validSourcePath(host,path,kind))throw Error('Source path rejected');
  let cached=(await this.pool.query('SELECT body FROM enrichment_source_cache WHERE host=$1 AND path=$2 AND expires_at>now()',[host,path])).rows[0];
  if(!cached&&kind==='json'&&/\/vehicle\//.test(path)){
   const old=(await this.pool.query("SELECT payload AS body FROM product_enrichment_vehicle_cache WHERE source_host=$1 AND resource_path=$2 AND fetched_at>now()-interval '30 days'",[host,path])).rows[0];
   if(old){await this.pool.query("INSERT INTO enrichment_source_cache(host,path,body,expires_at) VALUES($1,$2,$3,now()+interval '30 days') ON CONFLICT(host,path) DO NOTHING",[host,path,JSON.stringify(old.body)]);cached=old;}
  }
  if(cached){await this.pool.query('UPDATE enrichment_runs SET cache_hits=cache_hits+1 WHERE id=$1',[this.runId]);return cached.body;}
  await this.pool.query('INSERT INTO enrichment_source_requests(run_id,host,path,kind) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[this.runId,host,path,kind]);
  while(true){
   if(this.stopping)throw new WorkerStopped("Worker stopping");
   const row=(await this.pool.query('SELECT status,body,last_error FROM enrichment_source_requests WHERE run_id=$1 AND host=$2 AND path=$3',[this.runId,host,path])).rows[0];
   if(row.status==='complete')return row.body;
   if(row.status==='blocked')throw new SourceBlocked(row.last_error);
   if(row.status==='failed')throw Error(row.last_error);
   if((await this.pool.query('SELECT blocked,last_error FROM enrichment_source_hosts WHERE host=$1',[host])).rows[0]?.blocked)throw new SourceBlocked('Source circuit open: '+host);
   await new Promise(r=>setTimeout(r,1000));
  }
 }
 async claim(host:string):Promise<{id:string;token:string;path:string;kind:string}|{blocked:true}|{challenge:true}|{waitMs:number}>{
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN');
   const h=(await client.query('SELECT *,greatest(0,extract(epoch FROM next_allowed_at-now())*1000)::int AS wait_ms FROM enrichment_source_hosts WHERE host=$1 FOR UPDATE',[host])).rows[0];
   if(!h||h.blocked){await client.query('COMMIT');return {blocked:true};}
   if(h.challenge_since){await client.query('COMMIT');return {challenge:true};}
   if(h.wait_ms>0){await client.query('COMMIT');return {waitMs:h.wait_ms};}
   const busy=(await client.query("SELECT 1 FROM enrichment_source_requests WHERE host=$1 AND status='leased' AND lease_until>now() LIMIT 1",[host])).rowCount;
   if(busy){await client.query('COMMIT');return {waitMs:1000};}
   const row=(await client.query(`SELECT * FROM enrichment_source_requests WHERE run_id=$1 AND host=$2
    AND ((status='pending' AND available_at<=now()) OR (status='leased' AND lease_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,[this.runId,host])).rows[0];
   if(!row){await client.query('COMMIT');return {waitMs:1000};}
   const token=randomUUID();
   await client.query("UPDATE enrichment_source_requests SET status='leased',lease_token=$2,lease_until=now()+interval '90 seconds',attempts=attempts+1 WHERE id=$1",[row.id,token]);
   await client.query("UPDATE enrichment_source_hosts SET next_allowed_at=now()+interval_ms*interval '1 millisecond' WHERE host=$1",[host]);
   await client.query('COMMIT');return {id:row.id,token,path:row.path,kind:row.kind};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 async finish(input:{id:string;token:string;httpStatus:number;elapsedMs:number;bytes:number;retryAfter:string|null;error?:string;challenge?:boolean;body?:unknown}){
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN');
   const row=(await client.query("SELECT * FROM enrichment_source_requests WHERE id=$1 AND run_id=$2 AND lease_token=$3 AND status='leased' FOR UPDATE",[input.id,this.runId,input.token])).rows[0];
   if(!row){await client.query('ROLLBACK');throw Error('Stale request lease');}
   const decision=input.error&&input.httpStatus===200?{action:'fail' as const,waitMs:0}:sourceDecision(input.httpStatus,row.attempts,input.retryAfter,Date.now(),input.challenge);
   const error=input.error||`HTTP ${input.httpStatus}`;
   await client.query(`INSERT INTO enrichment_request_events(run_id,request_id,host,path,http_status,elapsed_ms,bytes,outcome,retry_after_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [this.runId,row.id,row.host,row.path,input.httpStatus,input.elapsedMs,input.bytes,decision.action,decision.waitMs]);
   if(decision.action==='complete'){
    if(input.body===undefined)throw Error('Successful response without body');
    const body=JSON.stringify(input.body);
    if(Buffer.byteLength(body)>15*1024*1024)throw Error('Source response too large');
    await client.query("INSERT INTO enrichment_source_cache(host,path,body,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 millisecond') ON CONFLICT(host,path) DO UPDATE SET body=EXCLUDED.body,fetched_at=now(),expires_at=EXCLUDED.expires_at",[row.host,row.path,body,cacheLifetime(row.path,row.kind)]);
    await client.query("UPDATE enrichment_source_requests SET status='complete',body=$2,finished_at=now(),lease_token=NULL,lease_until=NULL WHERE id=$1",[row.id,body]);
   }else if(decision.action==='challenge'){
    // The request was not served; it waits for the browser check without spending an attempt.
    await client.query("UPDATE enrichment_source_requests SET status='pending',available_at=now(),attempts=greatest(0,attempts-1),last_error=$2,lease_token=NULL,lease_until=NULL WHERE id=$1",[row.id,error]);
    await client.query('UPDATE enrichment_source_hosts SET challenge_since=coalesce(challenge_since,now()),challenges=challenges+1,last_error=$2 WHERE host=$1',[row.host,error]);
   }else if(decision.action==='retry'){
    await client.query("UPDATE enrichment_source_requests SET status='pending',available_at=now()+$2*interval '1 millisecond',last_error=$3,lease_token=NULL,lease_until=NULL WHERE id=$1",[row.id,decision.waitMs,error]);
    await client.query("UPDATE enrichment_source_hosts SET next_allowed_at=greatest(next_allowed_at,now()+$2*interval '1 millisecond'),last_error=$3,interval_ms=CASE WHEN $4=429 THEN least(30000,interval_ms*2) ELSE interval_ms END WHERE host=$1",[row.host,decision.waitMs,error,input.httpStatus]);
   }else{
    const status=decision.action==='block'?'blocked':'failed';
    await client.query('UPDATE enrichment_source_requests SET status=$2,last_error=$3,finished_at=now(),lease_token=NULL,lease_until=NULL WHERE id=$1',[row.id,status,error]);
    if(status==='blocked')await client.query('UPDATE enrichment_source_hosts SET blocked=true,last_error=$2 WHERE host=$1',[row.host,error]);
   }
   await client.query('COMMIT');
   return {action:decision.action,waitMs:decision.waitMs};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 // Returns a lease whose response never arrived (tab navigated or closed) without spending an attempt.
 async release(id:string,token:string){
  await this.pool.query("UPDATE enrichment_source_requests SET status='pending',available_at=now(),attempts=greatest(0,attempts-1),lease_token=NULL,lease_until=NULL WHERE id=$1 AND run_id=$2 AND lease_token=$3 AND status='leased'",[id,this.runId,token]);
 }
 async hostState(host:string):Promise<{blocked:boolean;challengeSince:Date|null;lastError:string|null}>{
  const h=(await this.pool.query('SELECT blocked,challenge_since,last_error FROM enrichment_source_hosts WHERE host=$1',[host])).rows[0];
  return {blocked:Boolean(h?.blocked),challengeSince:h?.challenge_since??null,lastError:h?.last_error??null};
 }
 async clearChallenge(host:string){await this.pool.query('UPDATE enrichment_source_hosts SET challenge_since=NULL,next_allowed_at=greatest(next_allowed_at,now()) WHERE host=$1',[host]);}
 async blockHost(host:string,error:string){await this.pool.query('UPDATE enrichment_source_hosts SET blocked=true,challenge_since=NULL,last_error=$2 WHERE host=$1',[host,error]);}
}
