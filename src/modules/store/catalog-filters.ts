import {z} from "zod";
const values=z.array(z.string().trim().min(1).max(200)).max(30);
/** Most raw values one attribute group may carry in the URL (a merged sidebar option adds several, #703). */
export const maxAttributeValues=40;
export const attributesSchema=z.record(z.string().min(1).max(200),z.array(z.string().trim().min(1).max(200)).max(maxAttributeValues)).refine(v=>Object.keys(v).length<=8);
export function selectedBrands(query:{brand?:string;brands?:string}):string[]{try{return query.brands?values.parse(JSON.parse(query.brands)):query.brand?[query.brand]:[];}catch{return [];}}
export function selectedAttributes(query:{attributes?:string}):Record<string,string[]>{try{return query.attributes?attributesSchema.parse(JSON.parse(query.attributes)):{};}catch{return {};}}
/** `values`: the raw spellings one sidebar option stands for (equivalent translations are merged, #703). */
export type CatalogFacet={key:string;label:string;options:{label:string;values:string[]}[]};
const sourceIdentityFields=new Set(["Brand class","Manufacturer","Manufacturer Part Number","EAN","Trade numbers"]);
// An OEM alternative can supply technical criteria, but does not identify our manufacturer's part.
export function catalogSpecifications(specifications:[string,string][],exactPart:boolean){
 return exactPart?specifications:specifications.filter(([key])=>!sourceIdentityFields.has(key));
}
const specificationLabels:Record<string,string>={"Number of mounting bores":"Montaj deliği sayısı","Thickness [mm]":"Kalınlık [mm]","Bolt Hole Circle Ø [mm]":"Bijon dairesi çapı [mm]","Surface":"Yüzey","Minimum thickness [mm]":"Minimum kalınlık [mm]","Centering Diameter [mm]":"Merkezleme çapı [mm]","Number of Holes":"Delik sayısı","Fulfils ECE standard":"ECE standardı","Bore Diameter up to [mm]":"Maksimum delik çapı [mm]","Processing":"İşleme","Trade numbers":"Ticari numaralar","Rim Hole Number":"Bijon deliği sayısı","Manufacturer":"Üretici","Manufacturer Part Number":"Üretici parça numarası","Lamp Type":"Lamba tipi","Bulb Type":"Ampul tipi","Fuel Type":"Yakıt tipi","Shock Absorber Type":"Amortisör tipi","Shock Absorber System":"Amortisör sistemi","Wiper blade type":"Silecek tipi","Oil Viscosity Classification SAE":"Yağ viskozitesi SAE","SAE viscosity class":"SAE viskozite sınıfı","Viscosity":"Viskozite","ACEA specification":"ACEA şartnamesi","API specification":"API şartnamesi","Oil specification":"Yağ şartnamesi","Specification":"Şartname","Transmission Type":"Şanzıman tipi","Mounting Type":"Montaj tipi","Fitting Position":"Montaj konumu","Brake Disc Type":"Fren diski tipi","Outer Diameter [mm]":"Dış çap [mm]","Brake Disc Thickness [mm]":"Fren diski kalınlığı [mm]","Height [mm]":"Yükseklik [mm]","Brand class":"Marka sınıfı","Length [mm]":"Uzunluk [mm]","Width [mm]":"Genişlik [mm]","Filter type":"Filtre tipi","Thread Size":"Diş ölçüsü"};
const specificationValues:Record<string,string>={"internally vented":"İçten havalandırmalı","Coated":"Kaplamalı","High-carbon":"Yüksek karbonlu","Front Axle":"Ön aks","Rear Axle":"Arka aks","Front Axle Left":"Ön aks sol","Front Axle Right":"Ön aks sağ","Rear Axle Left":"Arka aks sol","Rear Axle Right":"Arka aks sağ","Front":"Ön","Rear":"Arka","Left":"Sol","Right":"Sağ","solid":"Dolu","Vented":"Havalandırmalı","vented":"Havalandırmalı","Premium":"Premium","Budget":"Ekonomik","Price/Performance":"Fiyat/Performans"};
export function specificationLabel(key:string){return Object.hasOwn(specificationLabels,key)?specificationLabels[key]:key;}
export function specificationValue(value:string){return Object.hasOwn(specificationValues,value)?specificationValues[value]:value;}
/** Keys the catalog offers as filters (attributeFacets in catalog.ts), in one place for the facet SQL and the admin. */
export const facetSpecificationKeys=["Fitting Position","Brand class","Filter type","Lamp Type","Bulb Type","Fuel Type","Shock Absorber Type","Shock Absorber System","Wiper blade type","Oil Viscosity Classification SAE","Transmission Type","Mounting Type"] as const;
/**
 * Keys that identify the part rather than describe it: the product page prints its own manufacturer, part number,
 * OEM and barcode rows (#602, #582), so an admin cannot set them as a specification (hiding the automatic one is fine).
 */
export const reservedSpecificationKeys=["Manufacturer","Manufacturer Part Number","EAN","Trade numbers","OEM numarası","Barkod (EAN)"] as const;
/**
 * Whether two typed texts name the same key or value, ignoring case and surrounding space. Both the plain and the
 * Turkish lowercasing are tried: "FITTING POSITION" is "Fitting Position" (Turkish turns I into ı) and "İŞLEME" is "İşleme".
 */
export function sameSpecificationText(a:string,b:string){
 const x=a.trim(),y=b.trim();
 return x===y||x.toLowerCase()===y.toLowerCase()||x.toLocaleLowerCase("tr")===y.toLocaleLowerCase("tr");
}
const lookup=(entries:[string,string][],input:string)=>entries.find(([raw])=>raw===input.trim())?.[0]??entries.find(([raw])=>sameSpecificationText(raw,input))?.[0]??entries.find(([,label])=>sameSpecificationText(label,input))?.[0];
/** The raw (enrichment) key a typed key stands for: "Montaj konumu" and "fitting position" are "Fitting Position"; unknown keys stay as typed. */
export function specificationKey(input:string){return lookup(Object.entries(specificationLabels),input)??input.trim();}
/** The raw value a typed value of a known key stands for ("Ön aks" is "Front Axle"), so filters see one spelling; other values stay as typed. */
export function specificationRawValue(key:string,input:string){return Object.hasOwn(specificationLabels,key)?lookup(Object.entries(specificationValues),input)??input.trim():input.trim();}

/** The listing's range line (#674): "31 – 60 / 49.531 ürün" on page 2 of 30; "0 ürün" without results. */
export function listingRangeLabel(count: number, page: number, pageSize: number) {
  return count ? `${(page - 1) * pageSize + 1} – ${Math.min(page * pageSize, count)} / ${count.toLocaleString("tr-TR")} ürün` : "0 ürün";
}

type FilterQuery={brand?:string;brands?:string;attributes?:string;availability?:"in_stock"|"out_of_stock"|"supplied";fits?:"vehicle";oil?:string};
/** A change to a listing's filters; an `undefined` value drops that filter. */
export type FilterUpdate={[K in keyof FilterQuery]?:FilterQuery[K]|undefined};
/** The query change that ticks or unticks a manufacturer; a legacy single `brand` moves into `brands`. */
export function toggleBrand(query:FilterQuery,value:string):FilterUpdate{
 const current=selectedBrands(query),next=current.includes(value)?current.filter(v=>v!==value):[...current,value];
 return {brand:undefined,brands:next.length?JSON.stringify(next):undefined};
}
/** The query change that ticks or unticks one sidebar option: all of its raw spellings (`values`, #703) go in or out together. */
export function toggleAttribute(query:FilterQuery,key:string,values:string[]):FilterUpdate{
 const attributes=selectedAttributes(query),current=attributes[key]??[];
 const list=values.some(v=>current.includes(v))?current.filter(v=>!values.includes(v)):[...current,...values.filter(v=>!current.includes(v))];
 const next={...attributes,[key]:list};
 if(!list.length)delete next[key];
 return {attributes:Object.keys(next).length?JSON.stringify(next):undefined};
}
export const availabilityLabels={in_stock:"Stokta mevcut",out_of_stock:"Stokta yok",supplied:"Tedarik edilebilir"} as const;
const oilLabels:Record<string,string>={viscosity:"Önerilen viskozite",approval:"Önerilen yağ onayı"};
/** A selected filter shown as a removable chip; `remove` is the query change that drops it (listingUrl also drops the page). */
export type ActiveFilter={key:string;label:string;remove:FilterUpdate};
/** Whether a chip is one of the filter panel's own groups (manufacturer, option, stock) rather than the vehicle fit or engine oil. */
export const isPanelFilter=(item:ActiveFilter)=>!item.key.startsWith("fits")&&!item.key.startsWith("oil:");
/**
 * The filters a listing's query has selected, in sidebar order: manufacturers, options, stock, vehicle fit, engine oil.
 * A selected value the facets do not offer still gets a chip; the server adds those to `facets` with the sidebar's
 * translation and grouping (withSelectedOptions), and this fallback only groups values that read the same.
 */
export function activeFilters(query:FilterQuery,facets:CatalogFacet[],{vehicleName}:{vehicleName?:string}={}):ActiveFilter[]{
 const items:ActiveFilter[]=selectedBrands(query).map(brand=>({key:`brand:${brand}`,label:brand,remove:toggleBrand(query,brand)}));
 for(const [key,current] of Object.entries(selectedAttributes(query))){
  const facet=facets.find(f=>f.key===key),label=facet?.label??specificationLabel(key);
  const options=facet?.options.filter(o=>o.values.some(v=>current.includes(v)))??[];
  const covered=new Set(options.flatMap(o=>o.values));
  const loose=new Map<string,string[]>();
  for(const value of current.filter(v=>!covered.has(v))){const text=specificationValue(value);loose.set(text,[...loose.get(text)??[],value]);}
  for(const option of [...options,...[...loose].map(([text,values])=>({label:text,values}))])items.push({key:`attribute:${key}:${option.values[0]}`,label:`${label}: ${option.label}`,remove:toggleAttribute(query,key,option.values)});
 }
 if(query.availability)items.push({key:"availability",label:availabilityLabels[query.availability],remove:{availability:undefined}});
 if(query.fits)items.push({key:"fits",label:vehicleName?`Aracına uyanlar: ${vehicleName}`:"Aracına uyanlar",remove:{fits:undefined}});
 const oil=(query.oil??"").split(",").filter(filter=>Object.hasOwn(oilLabels,filter));
 for(const filter of oil)items.push({key:`oil:${filter}`,label:oilLabels[filter],remove:{oil:oil.filter(other=>other!==filter).join(",")||undefined}});
 return items;
}
/**
 * What the filter panel's "Temizle" clears: its own groups. The vehicle-fit and engine-oil filters are switched on from
 * their own boxes on the listing and come off one by one from their chips (or with "Tümünü temizle").
 */
export const clearPanelFilters:FilterUpdate={brand:undefined,brands:undefined,attributes:undefined,availability:undefined};
/** Every filter a chip can remove ("Tümünü temizle"). */
export const clearAllFilters:FilterUpdate={...clearPanelFilters,fits:undefined,oil:undefined};
