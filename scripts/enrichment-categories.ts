// Trodo source categories.
//   import-tree FILE      imports the Trodo category tree
//   backfill              fills Trodo enrichments' categories from the raw product API cache
//   learn-types           rebuilds the part type -> category dictionary (product_type_categories) from Trodo products
//   backfill-types --source spareto|parts2world [--hold] [--dry-run [--min-share 0.8] [--min-support 2]]
//                         writes the dictionary's categories to the source's enrichments by part type; prints counts
//                         and the 50 most common unmapped types. parts2world takes the names enrichment:parts2world --
//                         fetch-types (or collect) stored in parts2world_article_types (#852). --dry-run only reads; other thresholds only with it.
//                         --hold writes the categories but keeps imported_at, so storefront:sync does not carry them yet.
//   release-categories --source spareto|parts2world|all [--dry-run]
//                         sets imported_at=now() on the source's categorised enrichments (re-sends all of them, also ones
//                         already sent; harmless) so the next storefront:sync carries them; batches of 5000 rows.
//   report-types [--min-share 0.8] [--min-support 2]
//                         dictionary size at the thresholds and the types left out by them
//   report-unmapped [--source spareto|parts2world|all] [--limit 80] [--json]
//                         read-only (#860): per source rows without a type, mapped by learned types, by the curated list
//                         (src/modules/enrichment/type-aliases.ts) and unmapped; then the most common unmapped types with
//                         their spareto rows, parts2world rows and stored parts2world articles, and up to 3 suggestions
//                         (learned types / Trodo categories sharing words). The suggestions only help curate the list.
//   check-aliases         read-only: validates the curated list against the learned types and the category tree, lists
//                         redundant entries (a learned type wins) and entries learned types already resolve through a
//                         numeric tail or plural fold (resolvedWithout, info); exit code 1 on problems. learn-types runs it too.
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {importCategoryTree,productCategories} from '../src/modules/enrichment/source-categories';
import {requireEnrichmentSchema} from '../src/modules/enrichment/schema';
import {parseProduct,safeProductSlug} from '../src/modules/enrichment/trodo-adapter';
import {sparetoTypeFromUrl} from '../src/modules/enrichment/spareto-adapter';
import {parts2worldStoredTypes,parts2worldTypedEnrichments} from '../src/modules/enrichment/parts2world-types';
import {typeSuggester} from '../src/modules/enrichment/type-suggestions';
import {typeAliases} from '../src/modules/enrichment/type-aliases';
import {DEFAULT_MIN_SHARE,DEFAULT_MIN_SUPPORT,acceptedPairs,backfillTypeCategories,curatedDictionary,loadLearnedTypes,loadTypeCategories,resolveCuratedTypes,typeMatch,releaseTypeCategories,relearnTypeCategories,typedSourceUrlLike,typedSourceUrlPrefix,type TypedEnrichment,type TypedSource} from '../src/modules/enrichment/type-categories';
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
  "SELECT supplier_item_id,source_url,manufacturer FROM product_enrichments WHERE source_url LIKE $1 ORDER BY supplier_item_id",[typedSourceUrlLike('spareto')])).rows
  .map(r=>({supplierItemId:r.supplier_item_id,sourceUrl:r.source_url,type:sparetoTypeFromUrl(r.source_url,r.manufacturer)})),
 parts2world:()=>parts2worldTypedEnrichments(pool),
};
/** Validates the curated list (#860) against the learned types at the worker thresholds; prints the result and sets
 *  exit code 1 on problems. */
async function checkAliases(){
 const {entries,byId}=await loadLearnedTypes(pool);
 if(!entries.size){console.log(JSON.stringify({error:'Empty type dictionary; run learn-types first'}));process.exitCode=1;return;}
 const {curated,overrides,redundant,resolvedWithout,problems}=resolveCuratedTypes(entries,byId,typeAliases);
 console.log(JSON.stringify({entries:typeAliases.length,aliases:typeAliases.filter(e=>'alias' in e).length,categories:typeAliases.filter(e=>'categories' in e).length,
  applied:curated.size,overrides:overrides.size,redundant,resolvedWithout,problems},null,1));
 if(problems.length)process.exitCode=1;
}
type UnmappedType={type:string;spareto:number;parts2world:number;articles:number};
async function reportUnmapped(){
 const source=option('source')??'all',limit=Number(option('limit')??80);
 if(!['spareto','parts2world','all'].includes(source))throw Error('--source must be one of: spareto, parts2world, all');
 if(!Number.isInteger(limit)||limit<0)throw Error('--limit must be a non-negative integer');
 const {entries,byId}=await loadLearnedTypes(pool);
 if(!entries.size)throw Error('Empty type dictionary; run learn-types first');
 // As the workers see it: a list problem is warned about and its entry left out (check-aliases lists them).
 const dictionary=curatedDictionary(entries,byId,typeAliases);
 const summary:Record<string,{rows:number;noType:number;learned:number;curated:number;unmapped:number}>={},unmapped=new Map<string,UnmappedType>();
 const count=(name:string,key:'spareto'|'parts2world'|'articles',type:string|null,n=1)=>{
  const row=summary[name]??={rows:0,noType:0,learned:0,curated:0,unmapped:0};row.rows+=n;
  if(!type){row.noType+=n;return;}
  const {via}=typeMatch(dictionary,type);
  if(via){row[via]+=n;return;}
  row.unmapped+=n;
  const seen=unmapped.get(type)??{type,spareto:0,parts2world:0,articles:0};seen[key]+=n;unmapped.set(type,seen);
 };
 if(source!=='parts2world')for(const row of await typedSources.spareto())count('spareto','spareto',row.type);
 if(source!=='spareto'){
  for(const row of await typedSources.parts2world())count('parts2world','parts2world',row.type);
  for(const row of await parts2worldStoredTypes(pool))count('parts2worldArticles','articles',row.type||null,row.articles);
 }
 const suggest=typeSuggester(dictionary,byId);
 const types=[...unmapped.values()].sort((a,b)=>b.spareto+b.parts2world+b.articles-(a.spareto+a.parts2world+a.articles)||a.type.localeCompare(b.type))
  .slice(0,limit).map(t=>({...t,suggestions:suggest(t.type)}));
 if(args.includes('--json')){console.log(JSON.stringify({source,summary,unmappedTypes:unmapped.size,types},null,1));return;}
 console.log(JSON.stringify({source,summary,unmappedTypes:unmapped.size},null,1));
 console.log('spareto  p2w-rows  p2w-articles  type  ->  suggestions');
 for(const t of types)console.log(`${String(t.spareto).padStart(7)}  ${String(t.parts2world).padStart(8)}  ${String(t.articles).padStart(12)}  ${t.type}  ->  `+
  (t.suggestions.map(s=>`${s.kind==='type'?s.type:'['+s.categories.map(c=>c.id+' '+c.name).join(', ')+']'} (${s.score})`).join(' | ')||'-'));
}
// Read-only commands skip the schema check, so they run against a read-only connection as well; the schema comes from db:setup (#924).
const readOnly=['report-unmapped','check-aliases'].includes(process.argv[2]??'');
try{
 if(!readOnly)await requireEnrichmentSchema(pool,['source_categories','source_category_labels','product_source_categories','product_type_categories','parts2world_article_types']);
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
  // The relearned dictionary stays; problems in the curated list against it are reported (exit code 1).
  await checkAliases();
 }else if(process.argv[2]==='backfill-types'){
  const source=option('source')??'',rows=typedSources[source];
  if(!rows)throw Error('--source must be one of: '+Object.keys(typedSources).join(', '));
  // The spareto and parts2world workers write with the default thresholds; a written backfill with others would be undone product by
  // product as they are re-collected.
  if((option('min-share')!==undefined||option('min-support')!==undefined)&&!args.includes('--dry-run'))
   throw Error('--min-share / --min-support only with --dry-run: writes use the worker\'s thresholds ('+DEFAULT_MIN_SHARE+', '+DEFAULT_MIN_SUPPORT+')');
  // At other thresholds (dry run only) an alias target may not be accepted: warn and leave such entries out; the
  // worker's thresholds stay strict.
  const custom=option('min-share')!==undefined||option('min-support')!==undefined;
  const limits=thresholds(),dictionary=await loadTypeCategories(pool,{...limits,strict:!custom});
  if(!dictionary.exact.size)throw Error('Empty type dictionary; run learn-types first');
  const {unmappedTypes,...counts}=await backfillTypeCategories(pool,await rows(),dictionary,{dryRun:args.includes('--dry-run'),hold:args.includes('--hold')});
  console.log(JSON.stringify({source,...limits,dryRun:args.includes('--dry-run'),hold:args.includes('--hold'),types:dictionary.exact.size,curatedTypes:dictionary.curated.size+dictionary.overrides.size,...counts,unmappedTypeCount:unmappedTypes.length},null,1));
  for(const {type,count} of unmappedTypes.slice(0,50))console.log(String(count).padStart(6)+'  '+type);
 }else if(process.argv[2]==='release-categories'){
  const source=option('source')??'',known=Object.keys(typedSourceUrlPrefix) as TypedSource[];
  if(source!=='all'&&!known.includes(source as TypedSource))throw Error('--source must be one of: all, '+known.join(', '));
  for(const row of await releaseTypeCategories(pool,{sources:source==='all'?known:[source as TypedSource],dryRun:args.includes('--dry-run')}))console.log(JSON.stringify({...row,dryRun:args.includes('--dry-run')}));
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
 }else if(process.argv[2]==='report-unmapped')await reportUnmapped();
 else if(process.argv[2]==='check-aliases')await checkAliases();
 else throw Error('Usage: import-tree FILE | backfill | learn-types | backfill-types --source spareto|parts2world [--hold] [--dry-run [--min-share N] [--min-support N]] | release-categories --source spareto|parts2world|all [--dry-run] | report-types [--min-share N] [--min-support N] | report-unmapped [--source spareto|parts2world|all] [--limit 80] [--json] | check-aliases');
}finally{await pool.end();}
