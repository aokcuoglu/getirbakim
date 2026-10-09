import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCategoryTree,productCategories} from '../src/modules/enrichment/source-categories';
import {parseProduct} from '../src/modules/enrichment/trodo-adapter';
import type {Pool} from 'pg';
const tree=(category_data:unknown)=>({data:{relationships:{data:{category_data}}}});
test('source tree excludes internal ancestors and preserves named parent paths',()=>{
 const nodes=parseCategoryTree(tree({3:{a:'Car parts',b:'1/2/3',c:'car-parts'},814:{a:'Transmission',b:'1/2/3/814',c:'transmission'},824:{a:'Clutch kits',b:'1/2/3/814/824',c:'clutch-kits'}}));
 assert.deepEqual(nodes[2].path,[3,814,824]);assert.equal(nodes[2].parentId,814);assert.equal(nodes[0].parentId,null);
 assert.throws(()=>parseCategoryTree(tree({824:{a:'Clutch kits',b:'1/2/3/814/824',c:'clutch-kits'}})),/Missing/);
 assert.throws(()=>parseCategoryTree(tree({3:{a:'Car parts',b:'1/2/4',c:'car-parts'}})),/Invalid/);
});
test('product categories deduplicate IDs, use taxonomy ancestry and never infer unknown parents',async()=>{
 const db={query:async()=>({rows:[{category_id:3,name:'Car parts',path_ids:[3]},{category_id:824,name:'Clutch kits',path_ids:[3,824]}]})} as unknown as Pool;
 const product=parseProduct([{attributes:{entity_id:1,manufacturer:'LuK',tecdoc_sku:'123',category:[{category_id:'824',name:'Clutch kits'}],category_ids:[824]}}]);
 assert.deepEqual(await productCategories(db,product),[{source:'trodo',id:824,name:'Clutch kits',path:[{id:3,name:'Car parts'},{id:824,name:'Clutch kits'}]}]);
 assert.deepEqual(await productCategories(db,{...product,category:[{category_id:999,name:'New category'}],category_ids:[999]}),[{source:'trodo',id:999,name:'New category',path:[]}]);
 await assert.rejects(()=>productCategories(db,{...product,category:[],category_ids:[999]}),/Unknown/);
});
