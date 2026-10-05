import type {PoolClient} from 'pg';
import {loadFitmentMatcher} from '../store/fitment-sync';
export function createMatcherCache(){
 let revision:string|undefined, matcher:Awaited<ReturnType<typeof loadFitmentMatcher>>|undefined;
 return async(client:PoolClient)=>{
  // Caller holds the catalog advisory lock until its import transaction commits.
  const current=String((await client.query('SELECT revision FROM vehicle_catalog_revision WHERE id=true')).rows[0].revision);
  if(!matcher||current!==revision){matcher=await loadFitmentMatcher(client);revision=current;}
  return matcher;
 };
}
