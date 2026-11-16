import "server-only";
import {db} from "@/lib/db";
import {manufacturerBrandKey} from "./enrichment-contract";
import {manufacturerDirectory} from "./manufacturers.server";
import {getStaticManufacturerLogo} from "./storefront-logos";

export type ManufacturerLogo = {src: string; width: number; height: number};
/**
 * The logo of each shown brand: its own name first (bundled logo, then an imported one), then the other labels of its
 * master brand (#811: the store shows "UFI FILTRE" for the label UFI, whose logo is filed under UFI).
 */
export async function getManufacturerLogos(brands: string[]) {
  const logos = new Map<string,ManufacturerLogo>();
  for (const brand of brands) {
    const logo = getStaticManufacturerLogo(brand);
    if (logo) logos.set(brand,logo);
  }
  const missing = [...new Set(brands.filter(brand=>!logos.has(brand)))];
  if (!missing.length) return logos;
  const directory = await manufacturerDirectory();
  const candidates = new Map(missing.map(brand=>[brand,[brand,...directory.labelsOf(brand).filter(label=>label!==brand)]]));
  const keys = [...new Set([...candidates.values()].flat().map(manufacturerBrandKey).filter(Boolean))];
  const rows = keys.length ? (await db.query<{brand_key:string;sha256:string;width:number;height:number}>(
    "SELECT brand_key,sha256,width,height FROM manufacturer_logos WHERE brand_key=ANY($1::text[])",[keys])).rows : [];
  const byKey = new Map(rows.map(row=>[row.brand_key,row]));
  for (const [brand,names] of candidates) for (const name of names) {
    const row = byKey.get(manufacturerBrandKey(name));
    const logo = row ? {src:`/api/manufacturer-logos/${row.brand_key}?v=${row.sha256}`,width:row.width,height:row.height}
      : name === brand ? undefined : getStaticManufacturerLogo(name);
    if (logo) { logos.set(brand,logo); break; }
  }
  return logos;
}
