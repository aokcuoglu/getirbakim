import "server-only";
import { db } from "@/lib/db";
import { staleCache } from "@/lib/stale-cache";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { catalogSql, vehicleTypeProductIds } from "./catalog";
import { getCatalogProductImages } from "./product-enrichment";
import { packshotFor } from "./maintenance-kit-packshots.server";
import {
  filterBrandFamilies, familyOfRawBrand, kitSlotKeys, parseLiters, parseViscosity,
  type KitFilterKey, type KitItem, type KitSlotKey, type KitSlotOptions,
} from "./maintenance-kit";

// Product names are the only slot signal every supplier row has; Trodo categories cover a few
// thousand enriched products. Accessories that share the words (housings, gaskets) are left out.
const filterNames: Record<KitFilterKey, string> = {
  air: "HAVA FILTRE", oil: "YAG FILTRE", cabin: "POLEN|KABIN FILTRE", fuel: "YAKIT FILTRE|MAZOT FILTRE|BENZIN FILTRE",
};
const accessories = "GOVDE|KAPAK|CONTA|HORTUM|SENSOR|MUSUR|BORU|KELEPCE|SOGUTUCU|TAPA";
const whitelistedBrands = Object.values(filterBrandFamilies).flatMap(family => family.raw);
const withImage = "EXISTS (SELECT 1 FROM product_enrichments e WHERE e.supplier_item_id=c.id AND e.image_id IS NOT NULL AND e.match_basis->>'type'='exact_part')";

// Candidate ids change only with supplier syncs; prices and stock are read live for them below.
const cachedIds = staleCache<string[]>(10 * 60 * 1000);

function filterCandidateIds(key: KitFilterKey, fittedIds: string[] | null) {
  const values: unknown[] = [storefrontCompanies(), filterNames[key], accessories];
  const scope = fittedIds ? `c.id=ANY($4::uuid[])` : `c.brand=ANY($4::text[])`;
  values.push(fittedIds ?? whitelistedBrands);
  return db.query<{ id: string }>(`SELECT DISTINCT ON (c.brand) c.id::text FROM (${catalogSql}) c
    WHERE c.available AND c.price_kurus>0 AND c.name ~* $2 AND c.name !~* $3 AND ${scope}
    ORDER BY c.brand, ${withImage} DESC, c.price_kurus, c.id`, values).then(result => result.rows.map(row => row.id));
}

function engineOilCandidateIds() {
  return db.query<{ id: string }>(`SELECT id FROM (
     SELECT c.id::text, row_number() OVER (PARTITION BY c.brand ORDER BY c.price_kurus) AS rank FROM (${catalogSql}) c
     WHERE c.available AND c.price_kurus>0 AND c.name ~* 'MOTOR YAG' AND c.name ~* '\\m[0-9]{1,2}W-?[0-9]{2}\\M'
      AND c.name !~* 'DIFERANSIYEL|SANZIMAN|DISLI|ATF|GEAR'
      AND NULLIF(replace(substring(c.name from '(\\d+(?:[.,]\\d+)?)\\s*(?:L|LT|LITRE)\\M'),',','.'),'')::numeric BETWEEN 3 AND 7) ranked
    WHERE rank<=4`, [storefrontCompanies()]).then(result => result.rows.map(row => row.id));
}

async function liveItems(ids: string[]): Promise<KitItem[]> {
  if (!ids.length) return [];
  const rows = (await db.query<{ id: string; name: string; brand: string; code: string; price_kurus: number }>(
    `SELECT c.id::text,c.name,c.brand,c.code,c.price_kurus FROM (${catalogSql}) c
     WHERE c.id=ANY($2::uuid[]) AND c.available AND c.price_kurus>0`, [storefrontCompanies(), ids])).rows;
  // An enrichment matched through an OEM number can carry another brand's photo (a "Bosch" filter showing
  // a Filtron box); in a kit picture that misleads, so only exact part matches keep their photo.
  const [images, exact] = await Promise.all([getCatalogProductImages(rows), db.query<{ id: string }>(
    `SELECT supplier_item_id::text AS id FROM product_enrichments WHERE supplier_item_id=ANY($1::uuid[]) AND match_basis->>'type'='exact_part'`,
    [rows.map(row => row.id)]).then(result => new Set(result.rows.map(row => row.id)))]);
  return rows.map(row => ({
    id: row.id, name: row.name, brand: row.brand, family: familyOfRawBrand(row.brand), code: row.code, priceKurus: row.price_kurus,
    image: exact.has(row.id) ? images.get(row.id) : undefined, viscosity: parseViscosity(row.name), liters: parseLiters(row.name),
  }));
}

/** Attaches the brand's packaging cut-out for the slot, when the packshot library has one. */
async function withPackshots(slot: KitSlotKey, items: KitItem[]) {
  return Promise.all(items.map(async item => ({ ...item, packshot: await packshotFor(item.family, slot) })));
}

/** One product per brand family: the one with a photo first, then the cheapest. */
function onePerFamily(items: KitItem[]) {
  const best = new Map<string, KitItem>();
  for (const item of items) {
    const current = best.get(item.family);
    if (!current || (!!item.image !== !!current.image ? !!item.image : item.priceKurus < current.priceKurus)) best.set(item.family, item);
  }
  return [...best.values()].sort((a, b) => a.priceKurus - b.priceKurus);
}

/**
 * Kit options for the garage vehicle. A filter slot lists the products linked to the vehicle type;
 * when the vehicle has none for that slot (fitment data is still sparse) it falls back to stocked
 * products of the main filter brands and says so (`fitted: false`). Engine oil has no fitment data yet.
 */
export async function maintenanceKitOptions(vehicleTypeId: string | null): Promise<KitSlotOptions[]> {
  const fitted = vehicleTypeId ? await vehicleTypeProductIds(vehicleTypeId) : null;
  return Promise.all(kitSlotKeys.map(async (key): Promise<KitSlotOptions> => {
    if (key === "engineOil") {
      const items = await liveItems(await cachedIds("kit:engineOil", engineOilCandidateIds));
      return { key, items: await withPackshots(key, items.sort((a, b) => a.family.localeCompare(b.family) || a.priceKurus - b.priceKurus)), fitted: false };
    }
    if (fitted?.length) {
      const items = onePerFamily(await liveItems(await cachedIds(`kit:${key}:type:${vehicleTypeId}`, () => filterCandidateIds(key, fitted))));
      if (items.length) return { key, items: await withPackshots(key, items), fitted: true };
    }
    return { key, items: await withPackshots(key, onePerFamily(await liveItems(await cachedIds(`kit:${key}`, () => filterCandidateIds(key, null))))), fitted: false };
  }));
}

/** The products of a requested kit image, validated against the live catalog. */
export async function maintenanceKitItems(ids: Partial<Record<KitSlotKey, string>>) {
  const items = await liveItems(Object.values(ids).filter((id): id is string => Boolean(id)));
  const byId = new Map(items.map(item => [item.id, item]));
  const entries = await Promise.all(Object.entries(ids).flatMap(([key, id]) => byId.has(id!)
    ? [withPackshots(key as KitSlotKey, [byId.get(id!)!]).then(([item]) => [key, item] as const)] : []));
  return Object.fromEntries(entries) as Partial<Record<KitSlotKey, KitItem>>;
}
