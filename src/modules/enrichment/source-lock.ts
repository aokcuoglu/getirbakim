import type {Pool} from 'pg';
// Postgres advisory locks shared by every process that talks to a public source, so their paced clients never add up
// (the hourly fallback, the image fill and the pending pass all use spareto.com). Session locks on a dedicated client;
// they vanish with the connection, so a crashed process never leaves one behind.
export type SourceLock={release():Promise<void>};
/** Waits for the named lock and holds it until released. */
export async function acquireSourceLock(pool:Pool,name:string):Promise<SourceLock>{
 const client=await pool.connect();
 try{await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[name]);}
 catch(error){client.release();throw error;}
 return {async release(){await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[name]).catch(()=>{});client.release();}};
}
/** Takes the named lock only if nobody holds it; null means another process is running the same job. */
export async function tryExclusiveRun(pool:Pool,name:string):Promise<SourceLock|null>{
 const client=await pool.connect();
 try{
  const held=(await client.query<{locked:boolean}>('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[name])).rows[0].locked;
  if(!held){client.release();return null;}
 }catch(error){client.release();throw error;}
 return {async release(){await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[name]).catch(()=>{});client.release();}};
}
export async function withSourceLock<T>(pool:Pool,name:string,work:()=>Promise<T>):Promise<T>{
 const lock=await acquireSourceLock(pool,name);
 try{return await work();}finally{await lock.release();}
}
