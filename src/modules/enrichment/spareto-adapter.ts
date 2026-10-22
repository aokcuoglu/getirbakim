import {z} from 'zod';
import {enrichmentDataSchema,matchBasisSchema,matchesEnrichment,matchesSupplierPart,type EnrichmentData} from '../store/enrichment-contract';
import type {FitmentCatalogModel,FitmentCatalogType} from '../store/fitment-matcher';

export const SPARETO='https://spareto.com';
type MatchBasis=z.infer<typeof matchBasisSchema>;
export type Supplier={brand:string;code:string;oem:string;masterBrand?:string|null};
export type SearchCard={partNumber:string;brand:string;path:string};
export type VehicleFrame={make:string;model:string;path:string};
export type FitmentRow={make:string;name:string;from:string;to:string|null;kw:number;hp:number|null;cc:number|null};
export type ProductPage={brand:string;partNumber:string;name:string;image:string|null;specifications:[string,string][];
 oemNumbers:Record<string,string[]>;crossReferences:Record<string,string[]>;vehicleFrames:VehicleFrame[]};

const decode=(value:string)=>value.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');
const text=(html:string)=>decode(html.replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
const normalize=(value:string)=>value.toUpperCase().replace(/[^A-Z0-9]/g,'');
const productPath=/^\/products\/[a-z0-9-]+\/[a-z0-9-]+$/;

export const searchPath=(query:string)=>'/products?utf8=%E2%9C%93&keywords='+encodeURIComponent(query.trim());

/** Search result cards in page order: the card's analytics payload names the manufacturer and its part number. */
export function parseSearch(html:string):SearchCard[]{
 const cards=new Map<string,SearchCard>();
 for(const block of html.split(/(?=<div class='card bg-transparent card-product)/).slice(1)){
  const payload=/data-variant-card-gtm-item-value='([^']+)'/.exec(block),href=/href="(\/products\/[^"?#]+)"/.exec(block);
  if(!payload||!href||!productPath.test(href[1]))continue;
  let item:{item_id?:unknown;item_brand?:unknown};try{item=JSON.parse(decode(payload[1]));}catch{continue;}
  if(typeof item.item_id!=='string'||typeof item.item_brand!=='string')continue;
  if(!cards.has(href[1]))cards.set(href[1],{partNumber:item.item_id,brand:item.item_brand,path:href[1]});
 }
 return [...cards.values()];
}

// Labels that describe the listing or the seller rather than the part.
const ignoredSpecifications=/^(for OE number|Guarantee|Warranty|Customs Code|Country of Origin|Weight)$/i;
function referenceGroups(html:string){
 const groups:Record<string,string[]>={};
 for(const row of html.split(/(?=<div class='row py-2'>)/).slice(1)){
  const brand=/<div class='col-md-2[^']*'>([\s\S]*?)<\/div>/.exec(row),values=/<div class='col-md-10[^']*'>([\s\S]*?)<\/div>/.exec(row);
  if(!brand||!values)continue;
  const name=text(brand[1]),numbers=[...values[1].matchAll(/<(?:a|span)\b[^>]*>([\s\S]*?)<\/(?:a|span)>/g)].map(m=>text(m[1])).filter(v=>/\d/.test(v)&&v.length<=120);
  if(name&&numbers.length)groups[name]=[...new Set([...(groups[name]||[]),...numbers])];
 }
 return groups;
}
/** Product page: manufacturer, part number, photo, part properties and the OE / cross-reference tables. */
export function parseProductPage(html:string):ProductPage{
 const brand=/<div itemprop='brand'[^>]*>\s*<meta content='([^']+)' itemprop='name'>/.exec(html)?.[1];
 const partNumber=/<span itemprop='mpn'>([^<]+)<\/span>/.exec(html)?.[1];
 const name=/<span itemprop='name'>([^<]+)<\/span>/.exec(html)?.[1];
 if(!brand||!partNumber||!name)throw Error('Unrecognized spareto product page');
 const image=/<meta content='(https:\/\/cdn\.spareto\.com\/variants\/images\/[^']+)' itemprop='image'>/.exec(html)?.[1]??null;
 const specifications:[string,string][]=[];
 for(const row of html.matchAll(/<tr itemprop='additionalProperty'[^>]*>([\s\S]*?)<\/tr>/g)){
  const label=/itemprop='name'>([\s\S]*?)<\/td>/.exec(row[1]),value=/itemprop='value'>([\s\S]*?)<\/(?:td|span)>/.exec(row[1]),unit=/itemprop='unitText'>([\s\S]*?)<\/td>/.exec(row[1]);
  if(!label||!value)continue;
  const key=text(label[1]),val=[text(value[1]),unit?text(unit[1]):''].filter(Boolean).join(' ');
  if(key&&val&&!ignoredSpecifications.test(key)&&!specifications.some(([k,v])=>k===key&&v===val))specifications.push([key.slice(0,200),val.slice(0,5000)]);
 }
 const references=html.indexOf('Reference Numbers</h2>'),end=html.indexOf('Fit Vehicles',references);
 const section=references<0?'':html.slice(references,end<0?undefined:end);
 const cross=section.indexOf('Cross-Reference Numbers');
 return {brand:decode(brand).trim(),partNumber:decode(partNumber).trim(),name:decode(name).trim(),image:image&&decode(image),specifications:specifications.slice(0,100),
  oemNumbers:referenceGroups(cross<0?section:section.slice(0,cross)),crossReferences:cross<0?{}:referenceGroups(section.slice(cross)),vehicleFrames:parseVehicleFrames(html)};
}

export const fitmentPath=/^\/products\/[a-z0-9-]+\/[a-z0-9-]+\/fitment\?manufacturer_id=\d+&model_name=[A-Za-z0-9+%._~!*'()-]+$/;
/** "Fit Vehicles" lists makes and their models; each model's vehicles load lazily from its own fitment frame. */
export function parseVehicleFrames(html:string):VehicleFrame[]{
 const start=html.indexOf("id='nav-vehicles'");if(start<0)return [];
 const end=html.indexOf('</section>',start),frames:VehicleFrame[]=[];let make='',model='';
 for(const m of html.slice(start,end<0?undefined:end).matchAll(/<div class='col-6' style='font-weight: bold'>([^<]+)<\/div>|<div class='col-6 ps-4'>([^<]+)<\/div>|<turbo-frame\b[^>]*\ssrc="([^"]+)"/g)){
  if(m[1])make=decode(m[1]).trim();else if(m[2])model=decode(m[2]).trim();
  else{const path=decode(m[3]);if(make&&model&&fitmentPath.test(path)&&!frames.some(f=>f.path===path))frames.push({make,model,path});}
 }
 return frames;
}
/** Rows of one fitment frame: "<model> <engine>" as one TecDoc name, production months, kW, HP (often blank) and ccm. */
export function parseFitment(html:string,make:string):FitmentRow[]{
 const rows:FitmentRow[]=[],number=(value:string|undefined)=>/^\d+$/.test((value||'').trim())?Number(value):null;
 for(const row of html.split(/(?=<tr data-model-short-name=)/).slice(1)){
  const name=/<a\b[^>]*>([^<]+)<\/a>/.exec(row)?.[1],from=/<span class="from">(\d{4}-\d{2})<\/span>/.exec(row)?.[1],to=/<span class="to">([^<]*)<\/span>/.exec(row)?.[1];
  const cells=/<td class="power">([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td class="ccm">([^<]*)<\/td>/.exec(row),kw=number(cells?.[1]);
  if(!name||!from||!kw)continue;
  rows.push({make,name:decode(name).replace(/\s+/g,' ').trim(),from,to:to&&/^\d{4}-\d{2}$/.test(to.trim())?to.trim():null,kw,hp:number(cells?.[2]),cc:number(cells?.[3])});
 }
 return rows;
}
const upper=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
const monthYear=(value:string|null)=>value?`${value.slice(5)}/${value.slice(0,4)}`:null;
/** The source names no fuel and often no HP, which the strict fitment matcher compares. A row whose model, engine name,
 *  kW, ccm, months and any HP select exactly one catalog type takes fuel and HP from it; other rows keep a blank fuel
 *  and stay unmatched. A row that still lists the vehicle as in production may meet a type that has since closed. */
export function resolveVehicles(rows:FitmentRow[],models:FitmentCatalogModel[],types:FitmentCatalogType[]){
 const byMake=new Map<string,FitmentCatalogModel[]>(),byModel=new Map<number,FitmentCatalogType[]>();
 for(const model of models)for(const make of new Set([upper(model.brand),upper(model.display_brand)]))byMake.set(make,[...(byMake.get(make)||[]),model]);
 for(const type of types)byModel.set(type.model_id,[...(byModel.get(type.model_id)||[]),type]);
 const vehicles:EnrichmentData['vehicles']=[],invalid:{name:string;error:string}[]=[],seen=new Set<string>();let resolved=0;
 for(const row of rows){
  const name=upper(row.name),known=(byMake.get(upper(row.make))||[]).filter(m=>name.startsWith(upper(m.name)+' '));
  const longest=Math.max(0,...known.map(m=>upper(m.name).length)),owners=known.filter(m=>upper(m.name).length===longest);
  const engine=owners.length?name.slice(longest+1):'';
  const fits=owners.flatMap(m=>byModel.get(m.id)||[]).filter(t=>upper(t.name)===engine&&t.kwt===row.kw&&(t.cc??0)===(row.cc??0)
   &&(row.hp===null||t.hp===row.hp)&&t.date_from===row.from);
  const exact=fits.filter(t=>t.date_to===row.to),dated=exact.length||row.to!==null?exact:fits.filter(t=>t.date_to!==null);
  const type=dated.length===1?dated[0]:null,owner=type&&owners.find(m=>m.id===type.model_id);
  if(type)resolved++;
  const vehicle={model:owner?`${owner.brand} ${owner.name}`:owners.length?`${owners[0].brand} ${owners[0].name}`:`${row.make} ${row.name}`,
   engineAndCodes:engine||row.name,fuel:type?.fuel_type??'',kw:row.kw,ps:type?.hp??row.hp??Math.round(row.kw*1.35962),cc:type?type.cc??0:row.cc??0,
   from:monthYear(row.from),to:monthYear(row.to)};
  const key=JSON.stringify(vehicle);if(seen.has(key))continue;seen.add(key);
  const parsed=enrichmentDataSchema.shape.vehicles.element.safeParse(vehicle);
  if(parsed.success)vehicles.push(parsed.data);else invalid.push({name:row.name,error:parsed.error.issues.map(i=>i.path.join('.')+': '+i.message).join('; ')});
 }
 return {vehicles,invalid,resolved};
}

export function buildData(page:ProductPage,vehicles:EnrichmentData['vehicles']=[]):EnrichmentData{
 // The donor's own number is a cross reference of ours as well.
 const crossReferences={...page.crossReferences};
 if(!Object.values(crossReferences).flat().some(v=>normalize(v)===normalize(page.partNumber)))crossReferences[page.brand]=[...(crossReferences[page.brand]||[]),page.partNumber];
 const cap=(groups:Record<string,string[]>)=>Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.slice(0,500)]));
 return enrichmentDataSchema.parse({specifications:page.specifications,oemNumbers:cap(page.oemNumbers),crossReferences:cap(crossReferences),vehicles,vehicleModels:[]});
}

const references=(oem:string)=>[...new Set(oem.split(/[,;|\n]+|-(?=\d{6,})|(?<=\d{7})\s+(?=\d{7})/).map(v=>v.trim().replace(/\s*\/\s*(?:SET|KIT|TAKIM)$/i,'')).filter(v=>normalize(v).length>=4))];
/** Supplier OEM numbers worth searching; identity is still proven on the product page. */
export const supplierOemQueries=(supplier:Supplier)=>references(supplier.oem);
/** Part number as the source prints it: an unregistered supplier prefix ("COR 82018654") is dropped. */
export function partQuery(supplier:Supplier){
 const [head,...tail]=supplier.code.trim().split(/\s+/),rest=tail.join(' ');
 return /^[A-Za-z]{2,7}$/.test(head)&&/\d/.test(rest)?rest:supplier.code.trim();
}

/** The strongest identity the shared import contract accepts for this page, or null: the same part, an original OE
 *  number the supplier names, or the supplier's own brand and part listed among the page's cross references. */
export function identify(supplier:Supplier,page:ProductPage,data:Pick<EnrichmentData,'oemNumbers'|'crossReferences'>):MatchBasis|null{
 const source=(matchBasis:MatchBasis)=>({manufacturer:page.brand,partNumber:page.partNumber,data,matchBasis});
 if(matchesSupplierPart(supplier.brand,supplier.code,page.brand,page.partNumber,supplier.masterBrand))return {type:'exact_part'};
 // OE numbers must come from the page's OE table; the cross-reference table names aftermarket parts.
 const oeOnly={...data,crossReferences:{}};
 const oem:MatchBasis[]=[];
 if(/^OE-/.test(supplier.brand))oem.push({type:'oem_reference',reference:supplier.code,supplierOem:supplier.oem,referenceSource:'original_manufacturer_part_code'});
 for(const reference of references(supplier.oem))oem.push({type:'oem_reference',reference,supplierOem:supplier.oem,referenceSource:'supplier_oem'});
 // A donor whose own part number merely equals the reference ("630211" on an A.B.S. caliper) is a different part;
 // only the page's OE table proves the number is the original manufacturer's.
 const oeTable=new Set(Object.values(data.oemNumbers).flat().map(normalize));
 const verified=oem.find(basis=>basis.type==='oem_reference'&&oeTable.has(normalize(basis.reference))&&matchesEnrichment(supplier,{...source(basis),data:oeOnly}));
 if(verified)return verified;
 for(const [referenceBrand,values] of Object.entries(data.crossReferences))for(const reference of values){
  const basis:MatchBasis={type:'cross_reference',reference,referenceBrand};
  if(matchesEnrichment(supplier,source(basis)))return basis;
 }
 return null;
}

/** A re-collected partial product replaces the stored spareto data only when it is complete or brings more vehicles;
 *  a weaker result (fewer vehicles, a source that changed) keeps what is already published. */
export function improvesPartial(stored:{vehicles:number},collected:{completeness:'complete'|'partial';vehicles:number}){
 return collected.completeness==='complete'||collected.vehicles>stored.vehicles;
}
