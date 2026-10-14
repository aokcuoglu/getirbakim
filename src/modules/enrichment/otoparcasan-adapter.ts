import {z} from 'zod';
import {enrichmentDataSchema,matchesEnrichment,matchesSupplierPart,type EnrichmentData,type matchBasisSchema} from '../store/enrichment-contract';
export const OTOPARCASAN='https://otoparcasan.com/';
type MatchBasis=z.infer<typeof matchBasisSchema>;
export type Supplier={brand:string;code:string;oem:string};
const normalize=(value:string)=>value.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Z0-9]/g,'');
const decode=(value:string)=>value.replace(/<[^>]+>/g,'').replace(/&(#\d+|#x[\da-f]+|amp|lt|gt|quot|apos|#039);/gi,(_,code:string)=>
 code[0]==='#'?String.fromCodePoint(code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):Number(code.slice(1))):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"} as Record<string,string>)[code.toLowerCase()]).replace(/\s+/g,' ').trim();

const searchSchema=z.object({status:z.boolean(),response:z.object({source:z.array(z.object({url:z.string().min(1),urun_adi:z.string()})).default([])}).partial().default({})});
export function parseSearch(raw:unknown){return searchSchema.parse(raw).response.source||[];}
// Product slugs end with the stock code ("…-depo-214-1219l"); search also returns products that merely contain it.
export function codeCandidates(results:ReturnType<typeof parseSearch>,part:string){
 const code=normalize(part);return code.length<3?[]:results.filter(r=>/^[a-z0-9-]+$/.test(r.url)&&normalize(r.url).endsWith(code)).map(r=>r.url);
}

export type ProductPage={brand:string;partNumber:string;name:string;category:string;oems:string[];specifications:[string,string][];makers:{stok:string;manuId:string;name:string}[]};
export function parseProductPage(html:string):ProductPage{
 const info=/<div class="productInfos">\s*<div class="item"><span>Marka :<\/span>([^<]*)<\/div>\s*<div class="item"><span>Stok Kodu :<\/span>([^<]*)<\/div>/.exec(html);
 if(!info)throw Error('Product brand and stock code missing');
 const oemBlock=/<p class="oems">([\s\S]*?)<\/p>/.exec(html)?.[1]||'';
 const specBlock=/<ul class="kriter-list">([\s\S]*?)<\/ul>/.exec(html)?.[1]||'';
 const crumbs=/"@type":"BreadcrumbList"[\s\S]*?<\/script>/.exec(html)?.[0]||'';
 return {
  brand:decode(info[1]),partNumber:decode(info[2]),name:decode(/<title>([^<|]*)/.exec(html)?.[1]||''),
  category:[...crumbs.matchAll(/"name":"([^"]*)"/g)].map(m=>decode(m[1])).slice(2,-1).join(' / '),
  oems:[...oemBlock.matchAll(/<span>([\s\S]*?)<\/span>/g)].map(m=>decode(m[1])).filter(Boolean),
  // Rows without a value are notes ("Uzman personel tarafından montaj gereklidir!"), not specifications.
  specifications:[...specBlock.matchAll(/<li>\s*<span>([\s\S]*?)<\/span>\s*<span>([\s\S]*?)<\/span>\s*<\/li>/g)].map(m=>[decode(m[1]),decode(m[2])] as [string,string]).filter(([k,v])=>k&&v),
  makers:[...html.matchAll(/class="uyumluSelectButtons" data-stok="([^"]*)" data-manuid="(\d+)">[\s\S]*?<h4>([\s\S]*?)<\/h4>/g)].map(m=>({stok:decode(m[1]),manuId:m[2],name:decode(m[3])})),
 };
}

const vehicleSchema=z.object({typeId:z.coerce.string(),manuName:z.string(),modelName:z.string(),typeName:z.string(),fuelType:z.string(),
 powerKw:z.coerce.string(),powerHp:z.coerce.string(),cylinderCapacityCcm:z.coerce.string(),yearOfConstrFrom:z.coerce.string(),yearOfConstrTo:z.coerce.string().nullish()}).passthrough();
export function parseVehicles(raw:unknown){
 const body=z.object({status:z.boolean(),data:z.unknown()}).parse(raw);
 // A product without listed vehicles answers {status:false} or an empty data value.
 const cars=body.status?z.object({cars:z.array(z.unknown())}).safeParse(body.data):null;
 return cars?.success?cars.data.cars.map(row=>vehicleSchema.parse(row)):[];
}
export type SourceRow=z.infer<typeof vehicleSchema>;
// TecDoc's commercial-vehicle tree (trucks, tractors, mixers, bus chassis) carries no fuel type, and the vehicle
// catalog holds passenger cars and light commercials only; vans such as IVECO DAILY come from the passenger tree.
export const isCommercialVehicle=(row:SourceRow)=>!row.fuelType.trim();
const month=(value:string|null|undefined)=>{const m=/^(\d{4})(0[1-9]|1[0-2])$/.exec(String(value||'').trim());return m?`${m[2]}/${m[1]}`:null;};
/** Maps source rows to the shared vehicle contract the strict fitment matcher links by model and type name. */
export function toSourceVehicles(rows:SourceRow[],fuels:Map<string,string>){
 const vehicles:EnrichmentData['vehicles']=[],invalid:{typeId:string;error:string}[]=[];let commercial=0;const seen=new Set<string>();
 for(const row of rows){
  if(isCommercialVehicle(row)){commercial++;continue;}
  if(seen.has(row.typeId))continue;seen.add(row.typeId);
  const parsed=enrichmentDataSchema.shape.vehicles.element.safeParse({model:`${row.manuName} ${row.modelName}`.trim(),engineAndCodes:row.typeName.trim(),
   fuel:fuels.get(fuelKey(row.fuelType))||row.fuelType.trim(),kw:Number(row.powerKw),ps:Number(row.powerHp),cc:Number(row.cylinderCapacityCcm||0),
   from:month(row.yearOfConstrFrom),to:month(row.yearOfConstrTo)});
  if(parsed.success)vehicles.push(parsed.data);else invalid.push({typeId:row.typeId,error:parsed.error.issues.map(i=>i.path.join('.')+': '+i.message).join('; ')});
 }
 return {vehicles,invalid,commercial};
}
// The source spells catalog fuels differently: "Benzin/elektrikli" for "Benzin / Elektrik", "Benzin/oto gaz (LPG)" for "Benzin / LPG".
const fuelKey=(value:string)=>normalize(value).replace(/ELEKTRIKLI/g,'ELEKTRIK').replace(/OTOGAZLPG/g,'LPG').replace(/DOGALGAZCNG/g,'CNG');
/** Turkish catalog fuel names keyed for the source's spelling. */
export const fuelMap=(rows:{fuel_name:string;fuel_type:string}[])=>new Map(rows.map(r=>[fuelKey(r.fuel_name),r.fuel_type]));

/** One spelling per number; a truncated short listing ("544103" beside "544103E100") is dropped. */
export function uniqueOems(values:string[]){
 const keys=new Map<string,string>();for(const value of values){const key=normalize(value);if(key.length>=4&&!keys.has(key))keys.set(key,value.trim());}
 return [...keys].filter(([key])=>key.length>6||![...keys.keys()].some(other=>other!==key&&other.startsWith(key))).map(([,value])=>value);
}
// The source does not name the OE manufacturer. The storefront groups numbers by this key, so use the only vehicle
// make when there is exactly one, or the original manufacturer of "PSA ORJINAL" parts, else a neutral label.
export function oemOwner(page:ProductPage){
 const makes=new Set(page.makers.map(m=>m.name.trim().toUpperCase()).filter(Boolean));
 if(makes.size===1)return [...makes][0];
 const original=/^(.+?)\s+OR[İI]?J[İI]NAL$/iu.exec(page.brand.trim());return original?original[1].toUpperCase():'OE';
}
export function buildData(page:ProductPage,vehicles:EnrichmentData['vehicles']):EnrichmentData{
 const oems=uniqueOems(page.oems);
 return enrichmentDataSchema.parse({specifications:page.specifications,oemNumbers:oems.length?{[oemOwner(page)]:oems}:{},crossReferences:{},
  vehicles,vehicleModels:[...new Set(vehicles.map(v=>v.model))]});
}

const references=(oem:string)=>[...new Set(oem.split(/[,;|\n]+/).map(v=>v.trim().replace(/\s*\/\s*(?:SET|KIT|TAKIM)$/i,'')).filter(v=>normalize(v).length>=4))];
/** Supplier OEM numbers worth searching; identity is still proven on the product page. */
export const supplierOemQueries=(supplier:Supplier)=>references(supplier.oem);
/** The first identity the shared import contract accepts for this page, or null. */
export function identify(supplier:Supplier,page:ProductPage,data:Pick<EnrichmentData,'oemNumbers'|'crossReferences'>):MatchBasis|null{
 const source=(matchBasis:MatchBasis)=>({manufacturer:page.brand,partNumber:page.partNumber,data,matchBasis});
 const bases:MatchBasis[]=[{type:'exact_part'}];
 if(/^OE-/.test(supplier.brand))bases.push({type:'oem_reference',reference:supplier.code,supplierOem:supplier.oem,referenceSource:'original_manufacturer_part_code'});
 for(const reference of references(supplier.oem))bases.push({type:'oem_reference',reference,supplierOem:supplier.oem,referenceSource:'supplier_oem'});
 if(matchesSupplierPart(supplier.brand,supplier.code,page.brand,page.partNumber))return bases[0];
 return bases.slice(1).find(basis=>matchesEnrichment(supplier,source(basis)))||null;
}
