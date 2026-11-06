import {z} from 'zod';
import {enrichmentDataSchema,matchesSupplierPart,type EnrichmentData,type matchBasisSchema} from '../store/enrichment-contract';
type MatchBasis=z.infer<typeof matchBasisSchema>;

// parts2world.com runs ABCP's TecDoc module: a public JSON API behind its vehicle catalog (#382). It has no part-number
// search, so an article is reached by the ids of the old v1 catalog crawl (parts2world_articles), and identity is
// re-checked on the live answer. Vehicles carry the TecDoc type id (KType), which is our vehicle_types.id.
export const PARTS2WORLD='https://www.parts2world.com';
export const articleInfoPattern=/^\/api\/v2\/tecdoc\/article-info\/\d+\/\d+\/\d+\/$/;
export const articleInfoPath=(articleId:number|string,linkId:number|string,vehicleTypeId:number|string)=>
 `/api/v2/tecdoc/article-info/${articleId}/${linkId}/${vehicleTypeId}/`;
/** The page a person opens for the same article; stored as the enrichment's source. */
export const productUrl=(a:{articleId:number|string;linkId:number|string;vehicleTypeId:number|string})=>
 `${PARTS2WORLD}/tecdoc/#/product?mod=${a.vehicleTypeId}&link=${a.linkId}&id=${a.articleId}`;

const text=z.string().transform(value=>value.replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
const vehicleSchema=z.object({manuName:z.string(),modelName:z.string(),modificationId:z.number().int().positive(),modificationName:z.string(),
 cc:z.number().nullish(),fuelType:z.string().nullish(),hp:z.number().nullish(),kwt:z.number().nullish(),
 yearOfConstrFrom:z.string().nullish(),yearOfConstrTo:z.string().nullish()});
export const articleInfoSchema=z.object({data:z.object({
 id:z.number(),name:z.string(),brand:z.string(),spareInfo:z.string().nullish(),
 partProperties:z.union([z.record(z.string(),z.unknown()),z.array(z.unknown())]).nullish(),
 partImages:z.array(z.object({image:z.string(),thumb:z.string().nullish()})).nullish(),
 eanNumbers:z.array(z.unknown()).nullish(),
 oenNumbers:z.array(z.object({brand:z.string(),code:z.string()})).nullish(),
 applicability:z.array(vehicleSchema).nullish(),
 compabilityParts:z.array(z.object({brand:z.string(),article:z.string()})).nullish(),
}).nullable()});
export type ArticleInfo=NonNullable<z.infer<typeof articleInfoSchema>['data']>;
export type SourceVehicle=z.infer<typeof vehicleSchema>;
export type Supplier={brand:string;code:string;oem:string;masterBrand?:string|null};
/** Our catalog's view of a vehicle type, for the vehicle rows' text. */
export type CatalogType={id:number;brand:string;model:string;name:string;fuel_type:string;cc:number|null;hp:number;kwt:number;date_from:string;date_to:string|null};

/** The article in the answer, or null when the API has none for these ids. */
export function parseArticleInfo(raw:unknown):ArticleInfo|null{return articleInfoSchema.parse(raw).data;}

const monthYear=(value:string|null|undefined)=>{const m=/^(\d{4})-(\d{2})/.exec(value||'');return m?`${m[2]}/${m[1]}`:null;};
const normalize=(value:string)=>value.toUpperCase().replace(/[^A-Z0-9]/g,'');
/** Vehicle rows: a type our catalog knows is written with the catalog's names and figures (the matcher links it by
 *  its id either way); an unknown one keeps the source's, so it stays visible for review. */
export function buildVehicles(applicability:SourceVehicle[],catalog:Map<number,CatalogType>){
 const vehicles:EnrichmentData['vehicles']=[],invalid:{typeId:number;error:string}[]=[],seen=new Set<number>();let known=0;
 for(const row of applicability){
  if(seen.has(row.modificationId))continue;seen.add(row.modificationId);
  const type=catalog.get(row.modificationId);
  if(type)known++;
  const vehicle=type?{model:`${type.brand} ${type.model}`,engineAndCodes:type.name,fuel:type.fuel_type,kw:type.kwt,ps:type.hp,cc:type.cc??0,
   from:monthYear(type.date_from),to:monthYear(type.date_to),typeId:type.id}
   :{model:`${row.manuName} ${row.modelName}`,engineAndCodes:row.modificationName,fuel:row.fuelType??'',kw:row.kwt??0,ps:row.hp??0,cc:row.cc??0,
    from:monthYear(row.yearOfConstrFrom),to:monthYear(row.yearOfConstrTo),typeId:row.modificationId};
  const parsed=enrichmentDataSchema.shape.vehicles.element.safeParse(vehicle);
  if(parsed.success)vehicles.push(parsed.data);
  else invalid.push({typeId:row.modificationId,error:parsed.error.issues.map(i=>i.path.join('.')+': '+i.message).join('; ')});
 }
 return {vehicles,invalid,known,total:seen.size};
}

const group=(pairs:[string,string][])=>{
 const groups:Record<string,string[]>={};
 for(const [brand,value] of pairs){const b=brand.trim(),v=value.trim();if(!b||!v||v.length>120)continue;
  if(!groups[b])groups[b]=[];if(!groups[b].includes(v)&&groups[b].length<500)groups[b].push(v);}
 return groups;
};
export function buildData(info:ArticleInfo,vehicles:EnrichmentData['vehicles']=[]):EnrichmentData{
 const properties=info.partProperties&&!Array.isArray(info.partProperties)?Object.entries(info.partProperties):[];
 const specifications:[string,string][]=[];
 for(const [label,value] of properties){
  const key=text.parse(label).slice(0,200),val=typeof value==='string'||typeof value==='number'?text.parse(String(value)).slice(0,5000):'';
  if(key&&val&&!specifications.some(([k,v])=>k===key&&v===val))specifications.push([key,val]);
 }
 const eans=(info.eanNumbers||[]).map(String).filter(v=>/^\d{8,14}$/.test(v));
 if(eans.length)specifications.push(['EAN',[...new Set(eans)].join(', ')]);
 // The article's own number is a cross reference of ours as well, as with the other sources.
 const cross=(info.compabilityParts||[]).map(p=>[p.brand,p.article] as [string,string]);
 if(!cross.some(([,v])=>normalize(v)===normalize(info.name)))cross.push([info.brand,info.name]);
 return enrichmentDataSchema.parse({specifications:specifications.slice(0,100),oemNumbers:group((info.oenNumbers||[]).map(o=>[o.brand,o.code])),
  crossReferences:group(cross),vehicles,vehicleModels:[]});
}

/** Only the supplier's own brand and part number identify an archived article: its ids came from a catalog crawl,
 *  so the live answer must still name the same part. */
export const identify=(supplier:Supplier,info:ArticleInfo)=>matchesSupplierPart(supplier.brand,supplier.code,info.brand,info.name,supplier.masterBrand);
/** The import basis the live answer proves: the supplier's own brand/part, or for an original-part row matched through
 *  an OE number (#394) the article listing that number among its OE numbers. */
export function identifyBasis(supplier:Supplier&{oemReference?:string|null},info:ArticleInfo):MatchBasis|null{
 if(identify(supplier,info))return {type:'exact_part'};
 if(!supplier.oemReference||!/^OE-/.test(supplier.brand)||normalize(supplier.oemReference)!==normalize(supplier.code))return null;
 const listed=(info.oenNumbers||[]).some(o=>normalize(o.code)===normalize(supplier.code));
 return listed?{type:'oem_reference',reference:supplier.code,supplierOem:supplier.oem,referenceSource:'original_manufacturer_part_code'}:null;
}

/** The first product photo as an absolute URL on the site's own image path. */
export function imageUrl(info:ArticleInfo){
 const path=info.partImages?.find(i=>/^\/_debug\/tecdoc-images\/[0-9a-f/]+\.(?:jpe?g|png|webp)$/i.test(i.image))?.image;
 return path?PARTS2WORLD+path:null;
}

/** Complete means an image and vehicles, with every listed vehicle row valid. Vehicle types our catalog does not know
 *  yet are kept as unmatched rows and do not make the product partial: no other source would add them. */
export const parts2worldComplete=(c:{image:boolean;vehicles:number;invalid:number})=>c.image&&c.vehicles>0&&!c.invalid;
