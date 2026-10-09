import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
export type { CatalogQuery } from "./catalog-query";
import type { CatalogQuery } from "./catalog-query";
import {getStoreCategories} from './categories';
import {legacyCategoryIds} from './category-tree';
import {getVehicleBrandBySlug} from './vehicle-catalog.server';
import {selectedBrands,selectedAttributes,specificationLabel,type CatalogFacet} from './catalog-filters';
export type Product = { id: string; category: string; supplier: "dinamik" | "basbug" | "demo"; code: string; name: string; brand: string; description: string; price_kurus: number; stock: number; updated_at: Date };
export type CatalogProduct = Omit<Product, "price_kurus" | "stock" | "category"> & {
 category: string | null; price_kurus: number | null; stock: number | null; oem: string; source: "store" | "supplier";
 available: boolean; max_quantity: number; stock_label: string; pricing_snapshot: Record<string, unknown>;
};
// Prices and availability are calculated by the shared commerce view.
export const catalogSql = "SELECT * FROM commerce_catalog WHERE source='store' OR company=$1";
const catalogEntriesSql = "SELECT * FROM commerce_catalog_entries WHERE source='store' OR company=$1";
const company = () => process.env.BASBUG_FIRMA_ADI || "BASBUG";
export async function searchProducts(code: string): Promise<CatalogProduct[]> {
 if (!code.trim()) return [];
 return (await browseProducts({q:code,searchBy:"code"})).items;
}
export async function getProduct(id: string): Promise<CatalogProduct | undefined> {
 if (!z.uuid().safeParse(id).success) return undefined;
 return (await db.query<CatalogProduct>(`SELECT * FROM (${catalogSql}) catalog WHERE id=$2`,[company(),id])).rows[0];
}
export function servicePrice(price: number, discount: number) { return Math.round(price * (100-discount) / 100); }
export function money(kurus: number) { return new Intl.NumberFormat("tr-TR",{ style:"currency", currency:"TRY" }).format(kurus/100); }

export const categories = [
 {slug:"yedek-parca",name:"Yedek parçalar",art:"parts"},
 {slug:"fren",name:"Fren sistemi",art:"brakes"},
 {slug:"filtre",name:"Filtreler",art:"filter"},
 {slug:"yag",name:"Yağlar ve sıvılar",art:"oil"},
 {slug:"silecek",name:"Silecekler",art:"wipers"},
 {slug:"aksesuar",name:"Aksesuar ve ekipman",art:"tools"},
] as const;
async function catalogFilter(query:CatalogQuery) {
 const values: (string | number | number[] | string[])[] = [company()]; const clauses: string[] = [];
 if(query.q?.trim()) {
  values.push("%"+query.q.trim().slice(0,120).replace(/[\\%_]/g,"\\$&")+"%");
  const key = `$${values.length}`;
  const enrichedOem = `catalog.id IN (SELECT e.supplier_item_id FROM product_enrichments e
    JOIN supplier_items supplier_item ON supplier_item.id=e.supplier_item_id
      AND supplier_item.code=e.supplier_code AND supplier_item.product_data->>'uk'=e.supplier_brand
      AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=COALESCE(supplier_item.product_data->>'oe',''))
    CROSS JOIN LATERAL jsonb_each(e.payload->'oemNumbers') refs
    CROSS JOIN LATERAL jsonb_array_elements_text(refs.value) reference(number)
    WHERE reference.number ILIKE ${key})`;
  clauses.push(query.searchBy === "code" ? `(code ILIKE ${key} OR oem ILIKE ${key} OR ${enrichedOem})` : `(code ILIKE ${key} OR oem ILIKE ${key} OR name ILIKE ${key} OR brand ILIKE ${key} OR ${enrichedOem})`);
 }
 if(query.category) {
  const selected=(await getStoreCategories()).find(c=>c.slug===query.category);
  if(!selected)clauses.push('false');
  else {
   const descendants=(await getStoreCategories()).filter(c=>c.path.includes(selected.id)).map(c=>c.id);
   values.push(Object.entries(legacyCategoryIds).filter(([,id])=>descendants.includes(id)).map(([slug])=>slug));const legacyKey=`$${values.length}`;
   values.push(descendants);const idsKey=`$${values.length}`;
   clauses.push(`(catalog.category=ANY(${legacyKey}::text[]) OR catalog.id IN (
    SELECT pc.supplier_item_id FROM product_source_categories pc JOIN product_enrichments e USING(supplier_item_id)
    JOIN supplier_items s ON s.id=e.supplier_item_id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
    AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=COALESCE(s.product_data->>'oe',''))
    WHERE pc.source='trodo' AND pc.category_id=ANY(${idsKey}::int[])))`);
  }
 }
 if(query.make) {
  const make=await getVehicleBrandBySlug(query.make);
  if(!make)clauses.push('false');
  else {
   values.push(Number(make.id));
   // Only fitments observed in the product's current, trusted enrichment payload.
   clauses.push(`catalog.id IN (SELECT f.supplier_item_id FROM vehicle_models m
    JOIN vehicle_types v ON v.model_id=m.id
    JOIN product_vehicle_fitments f ON f.vehicle_type_id=v.id
    JOIN product_enrichments e ON e.supplier_item_id=f.supplier_item_id AND f.source_vehicle=e.payload->'vehicles'->f.source_index
    JOIN supplier_items s ON s.id=e.supplier_item_id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
    AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=COALESCE(s.product_data->>'oe',''))
    WHERE m.brand_id=$${values.length})`);
  }
 }
 const brands=selectedBrands(query);if(brands.length){values.push(brands);clauses.push(`brand=ANY($${values.length}::text[])`);}
 for(const [attribute,options] of Object.entries(selectedAttributes(query))){if(!options.length)continue;
  values.push(attribute);const attributeKey=`$${values.length}`;values.push(options);const optionsKey=`$${values.length}`;
  clauses.push(`catalog.id IN (SELECT e.supplier_item_id FROM product_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id
   AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
   AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=COALESCE(s.product_data->>'oe',''))
   CROSS JOIN LATERAL jsonb_array_elements(e.payload->'specifications') spec
   WHERE spec->>0=${attributeKey} AND spec->>1=ANY(${optionsKey}::text[])
   AND (spec->>0<>'Brand class' OR e.match_basis->>'type'='exact_part'))`);
 }
 if(query.availability)clauses.push(`catalog.id IN (SELECT id FROM (${catalogSql}) available_catalog WHERE ${query.availability==='in_stock'?'available':"NOT available AND stock_label='Stokta yok'"})`);
 const where = clauses.length ? "WHERE "+clauses.join(" AND ") : "";
 const from = `FROM (${catalogEntriesSql}) catalog ${where}`;
 return {values,where,from};
}
export async function browseProducts(query:CatalogQuery){
 const {values,where,from}=await catalogFilter(query);
 const total = Number((await db.query<{count:string}>(`SELECT count(*) ${from}`,values)).rows[0].count);
 const pageSize = 60, pages = Math.max(1,Math.ceil(total/pageSize));
 const requested = Number(query.page);
 const page = Number.isSafeInteger(requested) ? Math.min(pages,Math.max(1,requested)) : 1;
 const order=query.sort === "price-asc" ? "price_kurus ASC NULLS LAST,id" : query.sort === "price-desc" ? "price_kurus DESC NULLS LAST,id" : "updated_at DESC,id";
 const pricedSort = query.sort === "price-asc" || query.sort === "price-desc";
 const items = (await db.query<CatalogProduct>(pricedSort
  ? `SELECT * FROM (${catalogSql}) catalog ${where} ORDER BY ${order} LIMIT ${pageSize} OFFSET $${values.length+1}`
  : `WITH page AS MATERIALIZED (SELECT id,updated_at ${from} ORDER BY ${order} LIMIT ${pageSize} OFFSET $${values.length+1})
     SELECT catalog.* FROM page JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=page.id OFFSET 0) catalog ON true
     ORDER BY page.updated_at DESC,page.id`, [...values,(page-1)*pageSize])).rows;
 return {items,total,page,pages,pageSize};
}
export async function catalogBrands() {
 return (await db.query<{brand:string}>(`SELECT DISTINCT brand FROM (${catalogEntriesSql}) catalog ORDER BY brand`,[company()])).rows.map(p=>p.brand);
}

export async function catalogFacets(query:CatalogQuery){
 const {values,from}=await catalogFilter({q:query.q,searchBy:query.searchBy,category:query.category,make:query.make});
 const brands=(await db.query<{brand:string}>(`SELECT DISTINCT brand ${from} ORDER BY brand`,values)).rows.map(r=>r.brand);
 const rows=(await db.query<{key:string;values:string[]}>(`WITH scoped AS (SELECT catalog.id ${from})
 SELECT spec->>0 AS key,array_agg(DISTINCT spec->>1 ORDER BY spec->>1) AS values
 FROM scoped JOIN product_enrichments e ON e.supplier_item_id=scoped.id JOIN supplier_items s ON s.id=e.supplier_item_id
 AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
 AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=COALESCE(s.product_data->>'oe',''))
 CROSS JOIN LATERAL jsonb_array_elements(e.payload->'specifications') spec
 WHERE spec->>0 IN ('Fitting Position','Brand class','Filter type','Lamp Type','Bulb Type','Fuel Type','Shock Absorber Type','Shock Absorber System','Wiper blade type','Oil Viscosity Classification SAE','Transmission Type','Mounting Type') AND length(spec->>1)<=200
 AND (spec->>0<>'Brand class' OR e.match_basis->>'type'='exact_part')
 GROUP BY spec->>0 HAVING count(DISTINCT spec->>1)<=40 ORDER BY CASE WHEN spec->>0='Fitting Position' THEN 0 WHEN spec->>0='Brand class' THEN 1 ELSE 2 END,spec->>0 LIMIT 8`,values)).rows;
 return {brands,attributes:rows.map(row=>({...row,label:specificationLabel(row.key)})) as CatalogFacet[]};
}
