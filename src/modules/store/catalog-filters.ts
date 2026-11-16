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
