// Trodo source categories.
//   import-tree FILE      imports the Trodo category tree
//   backfill              fills Trodo enrichments' categories from the raw product API cache
//   learn-types           rebuilds the part type -> category dictionary (product_type_categories) from Trodo products
//   backfill-types --source spareto [--dry-run [--min-share 0.8] [--min-support 2]]
//                         writes the dictionary's categories to the source's enrichments by part type; prints counts
//                         and the 50 most common unmapped types. --dry-run only reads; other thresholds only with it.
//   report-types [--min-share 0.8] [--min-support 2]
//                         dictionary size at the thresholds and the types left out by them
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {importCategoryTree,productCategories} from '../src/modules/enrichment/source-categories';
import {parseProduct,safeProductSlug} from '../src/modules/enrichment/trodo-adapter';
import {sparetoTypeFromUrl} from '../src/modules/enrichment/spareto-adapter';
import {DEFAULT_MIN_SHARE,DEFAULT_MIN_SUPPORT,acceptedPairs,backfillTypeCategories,loadTypeCategories,relearnTypeCategories,type TypedEnrichment} from '../src/modules/enrichment/type-categories';
import {enrichmentDataSchema,matchBasisSchema,matchesEnrichment} from '../src/modules/store/enrichment-contract';

const pool=new Pool({connectionString:process.env.DATABASE_URL});
const args=process.argv.slice(3);
const option=(name:string)=>{const at=args.indexOf('--'+name);return at>=0?args[at+1]:undefined;};
function thresholds(){
 const minShare=Number(option('min-share')??DEFAULT_MIN_SHARE),minSupport=Number(option('min-support')??DEFAULT_MIN_SUPPORT);
 if(!(minShare>0&&minShare<=1))throw Error('--min-share must be in (0, 1]');
 if(!Number.isInteger(minSupport)||minSupport<1)throw Error('--min-support must be a positive integer');
 return {minShare,minSupport};
}
// Enrichments of each source without categories of its own, with the part type their source names.
const typedSources:Record<string,()=>Promise<TypedEnrichment[]>>={
 spareto:async()=>(await pool.query<{supplier_item_id:string;source_url:string;manufacturer:string}>(
  "SELECT supplier_item_id,source_url,manufacturer FROM product_enrichments WHERE source_url LIKE 'https://spareto.com/products/%' ORDER BY supplier_item_id")).rows
  .map(r=>({supplierItemId:r.supplier_item_id,sourceUrl:r.source_url,type:sparetoTypeFromUrl(r.source_url,r.manufacturer)})),
};
try{
 await pool.query(await readFile('db/source-categories.sql','utf8'));
 if(process.argv[2]==='import-tree'){
  if(!process.argv[3])throw Error('Category tree JSON path required');
  console.log(JSON.stringify(await importCategoryTree(pool,JSON.parse(await readFile(process.argv[3],'utf8')))));
 }else if(process.argv[2]==='backfill'){
  const rows=(await pool.query(`SELECT e.*,s.code,s.product_data->>'uk' AS brand,COALESCE(s.product_data->>'oe','') AS oem
   FROM product_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id`)).rows;
  let updated=0,missingCache=0,rejected=0;
  for(const row of rows){
   const client=await pool.connect();try{
    await client.query('BEGIN');
    // Match the observed source URL; neither a similar search hit nor a stale supplier identity is enough.
    const url=new URL(row.source_url);if(url.hostname!=='www.trodo.com'){rejected++;await client.query('ROLLBACK');continue;}
    const path='/rest/V1/catalog-product-api/product-url/'+url.pathname.slice(1)+'/IE';
    const cache=(await client.query("SELECT body FROM enrichment_source_cache WHERE host='www.trodo.com' AND path=$1",[path])).rows[0];
    if(!cache){missingCache++;await client.query('ROLLBACK');continue;}
    const product=parseProduct(cache.body),data=enrichmentDataSchema.parse(row.payload),basis=matchBasisSchema.parse(row.match_basis);
    if(safeProductSlug(product)!==url.pathname.slice(1)||product.manufacturer!==row.manufacturer||product.tecdoc_sku!==row.manufacturer_part_number||
     !matchesEnrichment(row,{manufacturer:row.manufacturer,partNumber:row.manufacturer_part_number,data,matchBasis:basis})){
     rejected++;await client.query('ROLLBACK');continue;
    }
    data.categories=await productCategories(client,product);
    // imported_at moves only when the categories change, so storefront:sync carries them (same reason as
    // otoparcasan-enrichment.ts images) without re-sending every enrichment a backfill revisits. The row is still
    // updated either way, so the mapping rewrite below runs as before.
    const result=await client.query(`UPDATE product_enrichments SET payload=jsonb_set(payload,'{categories}',$2::jsonb),
     imported_at=CASE WHEN payload->'categories' IS DISTINCT FROM $2::jsonb THEN now() ELSE imported_at END
     WHERE supplier_item_id=$1 AND payload=$3::jsonb AND source_url=$4 AND match_basis=$5::jsonb RETURNING supplier_item_id`,
     [row.supplier_item_id,JSON.stringify(data.categories),JSON.stringify(row.payload),row.source_url,JSON.stringify(row.match_basis)]);
    if(result.rowCount){
     await client.query('DELETE FROM product_source_categories WHERE supplier_item_id=$1',[row.supplier_item_id]);
     for(const category of data.categories)await client.query(`INSERT INTO product_source_categories(supplier_item_id,source,category_id)
      SELECT $1,source,category_id FROM source_categories WHERE source=$2 AND category_id=$3 ON CONFLICT DO NOTHING`,[row.supplier_item_id,category.source,category.id]);
    }
    updated+=result.rowCount??0;await client.query('COMMIT');
   }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  console.log(JSON.stringify({updated,missingCache,rejected}));
 }else if(process.argv[2]==='learn-types'){
  console.log(JSON.stringify(await relearnTypeCategories(pool)));
 }else if(process.argv[2]==='backfill-types'){
  const source=option('source')??'',rows=typedSources[source];
  if(!rows)throw Error('--source must be one of: '+Object.keys(typedSources).join(', '));
  // The spareto worker writes with the default thresholds; a written backfill with others would be undone product by
  // product as they are re-collected.
  if((option('min-share')!==undefined||option('min-support')!==undefined)&&!args.includes('--dry-run'))
   throw Error('--min-share / --min-support only with --dry-run: writes use the worker\'s thresholds ('+DEFAULT_MIN_SHARE+', '+DEFAULT_MIN_SUPPORT+')');
  const limits=thresholds(),dictionary=await loadTypeCategories(pool,limits);
  if(!dictionary.exact.size)throw Error('Empty type dictionary; run learn-types first');
  const {unmappedTypes,...counts}=await backfillTypeCategories(pool,await rows(),dictionary,{dryRun:args.includes('--dry-run')});
  console.log(JSON.stringify({source,...limits,dryRun:args.includes('--dry-run'),types:dictionary.exact.size,...counts,unmappedTypeCount:unmappedTypes.length},null,1));
  for(const {type,count} of unmappedTypes.slice(0,50))console.log(String(count).padStart(6)+'  '+type);
 }else if(process.argv[2]==='report-types'){
  const limits=thresholds();
  const pairs=(await pool.query<{type:string;category_id:number;support:number;total:number}>(
   "SELECT type,category_id,support,total FROM product_type_categories WHERE source='trodo'")).rows.map(r=>({type:r.type,categoryId:r.category_id,support:r.support,total:r.total}));
  const accepted=acceptedPairs(pairs,limits),types=new Set(pairs.map(p=>p.type)),kept=new Set(accepted.map(p=>p.type));
  const left=[...types].filter(t=>!kept.has(t)).map(type=>{const own=pairs.filter(p=>p.type===type);return {type,total:own[0].total,best:Math.max(...own.map(p=>p.support))};})
   .sort((a,b)=>b.total-a.total||a.type.localeCompare(b.type));
  console.log(JSON.stringify({...limits,types:types.size,pairs:pairs.length,acceptedTypes:kept.size,acceptedPairs:accepted.length,
   multiCategoryTypes:[...kept].filter(t=>accepted.filter(p=>p.type===t).length>1).length,leftOut:left.length},null,1));
  for(const {type,total,best} of left.slice(0,50))console.log(`${best}/${total}`.padStart(9)+'  '+type);
 }else throw Error('Usage: import-tree FILE | backfill | learn-types | backfill-types --source spareto [--dry-run [--min-share N] [--min-support N]] | report-types');
}finally{await pool.end();}
