import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {categorySlug} from '../src/modules/store/category-tree';
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const client=await pool.connect();try{
 await client.query('BEGIN');await client.query(await readFile('db/source-categories.sql','utf8'));
 const names=new Map((await readFile('data/trodo-categories-tr.tsv','utf8')).trim().split('\n').map(line=>{const [id,name]=line.split('|');if(!name)throw Error('Missing translation: '+id);return [Number(id),name] as const;}));
 const categories=(await client.query("SELECT category_id FROM source_categories WHERE source='trodo'")).rows;
 for(const c of categories){const name=names.get(c.category_id);if(!name)throw Error('Missing translation: '+c.category_id);
  await client.query(`INSERT INTO source_category_labels(source,category_id,locale,name,slug) VALUES('trodo',$1,'tr',$2,$3)
   ON CONFLICT(source,category_id,locale) DO UPDATE SET name=EXCLUDED.name,slug=EXCLUDED.slug`,[c.category_id,name,categorySlug(c.category_id,name)]);
 }
 await client.query(`INSERT INTO product_source_categories(supplier_item_id,source,category_id)
  SELECT e.supplier_item_id,'trodo',c.category_id FROM product_enrichments e
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(e.payload->'categories','[]')) r
  JOIN source_categories c ON c.source='trodo' AND c.category_id=(r->>'id')::int
  ON CONFLICT DO NOTHING`);
 await client.query('COMMIT');console.log({translated:categories.length});
}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await pool.end();}
