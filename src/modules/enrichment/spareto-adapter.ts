import {z} from 'zod';
import {enrichmentDataSchema,matchBasisSchema,matchesEnrichment,matchesSupplierPart,type EnrichmentData} from '../store/enrichment-contract';

export const SPARETO='https://spareto.com';
type MatchBasis=z.infer<typeof matchBasisSchema>;
export type Supplier={brand:string;code:string;oem:string;masterBrand?:string|null};
export type SearchCard={partNumber:string;brand:string;path:string};
export type ProductPage={brand:string;partNumber:string;name:string;image:string|null;specifications:[string,string][];
 oemNumbers:Record<string,string[]>;crossReferences:Record<string,string[]>};

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
  oemNumbers:referenceGroups(cross<0?section:section.slice(0,cross)),crossReferences:cross<0?{}:referenceGroups(section.slice(cross))};
}

export function buildData(page:ProductPage):EnrichmentData{
 // The donor's own number is a cross reference of ours as well.
 const crossReferences={...page.crossReferences};
 if(!Object.values(crossReferences).flat().some(v=>normalize(v)===normalize(page.partNumber)))crossReferences[page.brand]=[...(crossReferences[page.brand]||[]),page.partNumber];
 const cap=(groups:Record<string,string[]>)=>Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.slice(0,500)]));
 return enrichmentDataSchema.parse({specifications:page.specifications,oemNumbers:cap(page.oemNumbers),crossReferences:cap(crossReferences),vehicles:[],vehicleModels:[]});
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
