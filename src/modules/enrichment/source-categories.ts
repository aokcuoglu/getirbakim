import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import type {SourceProduct} from './trodo-adapter';

const nodeSchema=z.object({a:z.string().min(1).max(300),b:z.string().regex(/^\d+(\/\d+)+$/),c:z.string().regex(/^[a-z0-9][a-z0-9-]*$/)}).passthrough();
const treeSchema=z.object({data:z.object({relationships:z.object({data:z.object({category_data:z.record(z.string(),nodeSchema)})})})});
export function parseCategoryTree(raw:unknown){
 const data=treeSchema.parse(raw).data.relationships.data.category_data;
 return Object.entries(data).map(([key,node])=>{
  const id=Number(key),fullPath=node.b.split('/').map(Number);
  if(!Number.isSafeInteger(id)||id<=0||fullPath.at(-1)!==id||new Set(fullPath).size!==fullPath.length)throw Error('Invalid category path: '+key);
  const path=fullPath.filter(i=>Object.hasOwn(data,String(i)));
  // 1/2 are Magento's non-public ancestors; other missing ancestors are invalid.
  if(fullPath.slice(2).some(i=>!Object.hasOwn(data,String(i))))throw Error('Missing category ancestor: '+key);
  for(let i=0;i<path.length;i++)if(data[String(path[i])].b!==fullPath.slice(0,i+3).join('/'))throw Error('Inconsistent category ancestry: '+key);
  return {id,parentId:path.at(-2)??null,name:node.a,slug:node.c,path,sourceUrl:'https://www.trodo.com/'+node.c,raw:node};
 });
}
export async function importCategoryTree(pool:Pool,raw:unknown){
 const nodes=parseCategoryTree(raw);if(!nodes.length)throw Error('Empty category tree');
 const client=await pool.connect();try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(20261007,1)');
  for(const n of nodes)await client.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw)
   VALUES('trodo',$1,$2,$3,$4,$5,$6,$7) ON CONFLICT(source,category_id) DO UPDATE SET
   parent_id=EXCLUDED.parent_id,name=EXCLUDED.name,slug=EXCLUDED.slug,path_ids=EXCLUDED.path_ids,source_url=EXCLUDED.source_url,raw=EXCLUDED.raw,fetched_at=now()`,
   [n.id,n.parentId,n.name,n.slug,n.path,n.sourceUrl,JSON.stringify(n.raw)]);
  await client.query('COMMIT');return {categories:nodes.length,roots:nodes.filter(n=>n.parentId===null).map(n=>({id:n.id,name:n.name}))};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function productCategories(db:Pool|PoolClient,product:SourceProduct){
 const refs=new Map((product.category??[]).map(c=>[Number(c.category_id),c.name]));
 const ids=[...new Set([...(product.category_ids??[]).map(Number),...refs.keys()])];
 if(!ids.length)return [];
 const nodes=(await db.query<{category_id:number;name:string;path_ids:number[]}>('SELECT category_id,name,path_ids FROM source_categories WHERE source=$1',['trodo'])).rows;
 const byId=new Map(nodes.map(n=>[n.category_id,n]));
 return ids.map(id=>{
  const node=byId.get(id),name=node?.name??refs.get(id);
  if(!name)throw Error('Unknown source category without name: '+id);
  return {source:'trodo' as const,id,name,path:node?node.path_ids.map(i=>{const ancestor=byId.get(i);if(!ancestor)throw Error('Missing category ancestor: '+i);return {id:i,name:ancestor.name};}):[]};
 });
}
