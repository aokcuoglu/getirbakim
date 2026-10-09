import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {importCategoryTree,productCategories} from '../src/modules/enrichment/source-categories';
import {parseProduct,safeProductSlug} from '../src/modules/enrichment/trodo-adapter';
import {enrichmentDataSchema,matchBasisSchema,matchesEnrichment} from '../src/modules/store/enrichment-contract';

const pool=new Pool({connectionString:process.env.DATABASE_URL});
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
    const result=await client.query(`UPDATE product_enrichments SET payload=jsonb_set(payload,'{categories}',$2::jsonb)
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
 }else throw Error('Usage: import-tree FILE | backfill');
}finally{await pool.end();}
