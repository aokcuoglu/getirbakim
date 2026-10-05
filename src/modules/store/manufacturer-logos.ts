import "server-only";
import {db} from "@/lib/db";
import {manufacturerBrandKey} from "./enrichment-contract";

export type ManufacturerLogo = {src: string; width: number; height: number};
export async function getManufacturerLogos(brands: string[]) {
  const keys = [...new Set(brands.map(manufacturerBrandKey).filter(Boolean))];
  const logos = new Map<string,ManufacturerLogo>();
  if (!keys.length) return logos;
  const rows = (await db.query<{brand_key:string;sha256:string;width:number;height:number}>(
    "SELECT brand_key,sha256,width,height FROM manufacturer_logos WHERE brand_key=ANY($1::text[])",[keys])).rows;
  const byKey = new Map(rows.map(row=>[row.brand_key,row]));
  for (const brand of brands) {
    const row = byKey.get(manufacturerBrandKey(brand));
    if (row) logos.set(brand,{src:`/api/manufacturer-logos/${row.brand_key}?v=${row.sha256}`,width:row.width,height:row.height});
  }
  return logos;
}
