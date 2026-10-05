import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
export type { CatalogQuery } from "./catalog-query";
import type { CatalogQuery } from "./catalog-query";
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
export async function browseProducts(query: CatalogQuery) {
 const values: (string | number)[] = [company()]; const clauses: string[] = [];
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
 if(query.category && categories.some(c=>c.slug===query.category)) { values.push(query.category); clauses.push(`category=$${values.length}`); }
 if(query.brand) { values.push(query.brand.slice(0,200)); clauses.push(`brand=$${values.length}`); }
 const where = clauses.length ? "WHERE "+clauses.join(" AND ") : "";
 const from = `FROM (${catalogEntriesSql}) catalog ${where}`;
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
