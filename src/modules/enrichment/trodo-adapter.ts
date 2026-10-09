import {z} from 'zod';
import {enrichmentDataSchema,matchesSupplierPart,manufacturerBrandKey} from '../store/enrichment-contract';
import type {SourceQueue} from './source-queue';
const categoryId=z.coerce.number().int().positive();
export const productSchema=z.object({entity_id:z.union([z.string(),z.number()]),manufacturer:z.string().min(1),tecdoc_sku:z.string().min(1),url_key:z.string().nullish(),url_path:z.string().nullish(),media:z.object({src:z.string().nullish()}).passthrough().nullish(),category:z.array(z.object({category_id:categoryId,name:z.string().min(1)})).nullish(),category_ids:z.array(categoryId).nullish()}).passthrough();
const labelSchema=z.object({name:z.string(),kw_ps:z.string(),year:z.string(),ccm:z.union([z.string(),z.number()]),engine:z.array(z.string()).optional(),engine_fuel:z.string().optional()}).passthrough();
const modelSchema=z.object({value:z.union([z.string(),z.number()]),label:z.object({name:z.string()})}).passthrough();
const engineSchema=z.object({value:z.union([z.string(),z.number()]),label:labelSchema,fuel:z.string().optional()}).passthrough();
const relationshipsSchema=z.object({oe_numbers:z.record(z.string(),z.array(z.object({oem:z.union([z.string(),z.number()]),value:z.string()}))).nullable(),attributes:z.object({criteria:z.array(z.object({label:z.string(),value:z.union([z.string(),z.number()]).nullable()}))}),vehicle_ids:z.array(z.union([z.string(),z.number()])).nullable().transform(v=>v||[]),vehicle_list:z.union([z.array(z.never()).length(0).transform(()=>({list:{}})),z.object({list:z.record(z.string(),z.object({automaker_id:z.union([z.string(),z.number()]),automaker_label:z.object({name:z.string()}),model_list:z.array(z.object({value_id:z.union([z.string(),z.number()])}))}))})])});
export type SourceProduct=z.infer<typeof productSchema>;
export type SourceView=z.infer<typeof relationshipsSchema>;
export function sourcePartQuery(brand:string,code:string){
 // Strip only prefixes accepted by the shared exact-match contract.
 const rest=code.trim().split(/\s+/).slice(1).join(' ');
 return rest&&matchesSupplierPart(brand,code,brand,rest)?rest:code;
}
export function sourcePartQueries(brand:string,code:string){
 const part=sourcePartQuery(brand,code).trim(),name=brand.trim();
 // Searches only discover candidates, so an unregistered supplier prefix ("GLS T85010-00") may be dropped here;
 // identity is still decided by the exact-match contract or a verified original OEM reference.
 const [head,...tail]=part.split(/\s+/),rest=tail.join(' ');
 const unprefixed=/^[A-Z]{2,5}$/i.test(head)&&/\d/.test(rest)?rest:part;
 const compact=unprefixed.replace(/[^a-z0-9]/gi,'');
 return [...new Set([part,unprefixed,compact,`${name} ${unprefixed}`].filter(Boolean))];
}
export function parseView(raw:unknown){return z.array(z.object({relationships:relationshipsSchema})).min(1).parse(raw)[0].relationships;}
export function parseProduct(raw:unknown){return z.array(z.object({attributes:productSchema})).min(1).parse(raw)[0].attributes;}
// Same parameters as the site's search results page ("By name").
export function searchPath(query:string){return '/rest/V1/catalogsearch/result/0?q='+encodeURIComponent(query)+'&searchby=name&product_list_order=_score&product_list_dir=desc&is_ajax=true&customer_group_id=undefined&currency=EUR&list-type=list&country=IE';}
// The site's OE-number page lists products whose OE references contain the number.
export function oemSearchPath(oem:string){return '/rest/V1/catalogsearch/oem/'+oem.replace(/[^a-z0-9]/gi,'').toUpperCase()+'?is_ajax=true&customer_group_id=undefined&currency=EUR&list-type=list&country=IE';}
export function parseSearch(raw:unknown){return z.array(z.object({products:z.array(productSchema),pagination:z.unknown().optional()})).min(1).parse(raw)[0];}
export function parseEngine(model:string,raw:unknown){
 const engine=engineSchema.parse(raw),label=engine.label;
 const power=/^\s*([\d.]+)kW\/([\d.]+)PS\s*$/.exec(label.kw_ps),dates=label.year.split('-'),cc=/^\d+/.exec(String(label.ccm));
 if(!power||!cc||dates.length!==2)throw Error('Malformed source vehicle label');
 return enrichmentDataSchema.shape.vehicles.element.parse({model,engineAndCodes:(label.name+' '+(label.engine||[]).join('; ')).trim(),fuel:label.engine_fuel||engine.fuel||'',kw:Number(power[1]),ps:Number(power[2]),cc:Number(cc[0]),from:dates[0],to:dates[1]==='0/0'?null:dates[1]});
}
export async function collectVehicles(queue:SourceQueue,view:SourceView){
 const ids=new Set(view.vehicle_ids.map(String)),covered=new Set<string>(),models:string[]=[],vehicles=[],invalid:unknown[]=[];
 for(const make of Object.values(view.vehicle_list.list)){
  covered.add(String(make.automaker_id));
  for(const group of make.model_list){
   covered.add(String(group.value_id));
   const raw=await queue.get('www.trodo.com','/rest/V1/vehicle/models/1/'+group.value_id);
   const rows=z.array(z.object({relationships:z.object({data:z.array(modelSchema)})})).min(1).parse(raw)[0].relationships.data;
   for(const model of rows.filter(m=>ids.has(String(m.value)))){
    covered.add(String(model.value));const name=make.automaker_label.name+' '+model.label.name.trim();models.push(name);
    const types=await queue.get('www.trodo.com','/rest/V1/vehicle/type/1/'+model.value);
    const engines=z.array(z.object({relationships:z.object({data:z.array(engineSchema)})})).min(1).parse(types)[0].relationships.data;
    for(const engine of engines.filter(e=>ids.has(String(e.value)))){
     try{vehicles.push(parseEngine(name,engine));covered.add(String(engine.value));}
     catch(error){invalid.push({id:engine.value,raw:engine,error:String(error)});}
    }
   }
  }
 }
 return {vehicles,vehicleModels:[...new Set(models)],coverage:{expected:ids.size,covered:[...ids].filter(id=>covered.has(id)).length,unresolved:[...ids].filter(id=>!covered.has(id)),invalid}};
}
export function normalizeData(view:SourceView,vehicle:Awaited<ReturnType<typeof collectVehicles>>){
 const oemNumbers:Record<string,string[]>={},crossReferences:Record<string,string[]>={};
 for(const [brand,refs] of Object.entries(view.oe_numbers||{}))for(const ref of refs){
  if(!['0','1'].includes(String(ref.oem)))throw Error('Unrecognized OEM/reference marker');
  const values=(String(ref.oem)==='1'?oemNumbers:crossReferences)[brand]??=[];
  if(!values.includes(ref.value))values.push(ref.value);
 }
 return enrichmentDataSchema.parse({specifications:view.attributes.criteria.filter(a=>a.label&&a.value!==null&&String(a.value)).map(a=>[a.label,String(a.value)]),oemNumbers,crossReferences,vehicles:vehicle.vehicles,vehicleModels:vehicle.vehicleModels});
}
export function chooseExact(brand:string,code:string,products:SourceProduct[]){
 const found=products.filter(p=>matchesSupplierPart(brand,code,p.manufacturer,p.tecdoc_sku));
 // The same catalog item can appear in both part-code and OEM searches.
 const unique=[...new Map(found.map(p=>[String(p.entity_id),p])).values()];
 return unique.length===1?unique[0]:null;
}
export function supplierOemQueries(oem:string){
 const refs=oem.split(/[,;|\n]+|(?<=\d{7})\s+(?=\d{7})/).map(s=>s.trim()).filter(Boolean);
 // Supplier notation for kits ("HX7G 6065 AB/SET"): the base OE number is what source catalogs list.
 // Placeholders such as "." or "-" are not OE numbers.
 return [...new Set(refs.flatMap(r=>[r,r.replace(/\s*\/\s*(?:SET|KIT|TAKIM)$/i,'')]))].filter(r=>r.replace(/[^a-z0-9]/gi,'').length>=4);
}
export function verifiedOemReference(oem:string,view:SourceView){
 const key=(s:string)=>s.toUpperCase().replace(/[^A-Z0-9]/g,'');
 const references=new Set(Object.values(view.oe_numbers||{}).flat().filter(r=>String(r.oem)==='1').map(r=>key(r.value)));
 return supplierOemQueries(oem).find(q=>references.has(key(q)))||null;
}
export function imagePath(product:SourceProduct){
 if(!product.media?.src)return null;
 const path='/media/m2_catalog_cache/1440x1440'+product.media.src;
 if(!path.startsWith('/media/m2_catalog_cache/1440x1440%2F')&&!path.startsWith('/media/m2_catalog_cache/1440x1440/'))return null;
 return path;
}
export function safeProductSlug(product:SourceProduct){
 const slug=product.url_key||product.url_path;
 if(!slug||!/^\/?[a-z0-9][a-z0-9-]+$/.test(slug))throw Error('Invalid product slug');
 return slug.replace(/^\//,'');
}
export {manufacturerBrandKey};
