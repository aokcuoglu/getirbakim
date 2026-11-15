import "server-only";
import { shownProductName } from "./product-name";
import { db } from "@/lib/db";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { catalogSql, categoryProductIds, notSecondaryOffer, typeFittedIds, withBestOffers, type CatalogProduct } from "./catalog";
import { productPath } from "@/modules/seo/product-path";
import { getCatalogProductImages, type CatalogProductImage } from "./product-enrichment";
import { getManufacturerLogos, type ManufacturerLogo } from "./manufacturer-logos";
import { getVehicleOilSpec, vehicleOilProductIds } from "./vehicle-oil.server";
import { engineOilNameSql, notEngineOilNameSql, oilCapacity, plainEngineOilNameSql, vehicleOilFilters, type VehicleOilSpec } from "./vehicle-oil";
import { kitSlots, oilPackLitres, oilPackQuantity, type KitSlotKey } from "./maintenance-kit";

/** A product the shopper can put in a slot: the listing row priced by its best offer, with picture and brand logo. */
export type KitCandidate = {
  id: string;
  /** The offer sold (a secondary supplier's row when it is cheaper); what goes into the cart. */
  offerId: string;
  /** The product page. */
  href: string;
  /** The store brand and part number (#602): an admin's, else the supplier's. */
  name: string; brand: string; code: string;
  priceKurus: number; maxQuantity: number; stockLabel: string;
  image: CatalogProductImage | null; logo: ManufacturerLogo | null;
  /** Engine oil only: litres per pack read from the name, and the packs the vehicle's capacity needs. */
  packLitres: number | null; suggestedQuantity: number;
};
export type KitSlotOptions = {
  key: KitSlotKey;
  /** Cheapest first; at most `perBrandLimit` per brand so one brand's size range does not crowd the list. */
  candidates: KitCandidate[];
  /** Engine oil: whether the candidates meet the vehicle's viscosity and approvals, or its viscosity only. */
  oilMatch?: "full" | "viscosity" | "none";
};
export type MaintenanceKitOptions = { slots: KitSlotOptions[]; oilSpec: VehicleOilSpec | null; oilCapacityLabel: string | null };

const perBrandLimit = 6;
const sellable = (product: CatalogProduct) => product.available && product.price_kurus !== null && product.max_quantity > 0;

/** Listed, sellable catalog rows among `ids`, priced by their best offer: commerce_catalog holds supplied rows only (#677). */
export async function sellableProducts(ids: string[]) {
  if (!ids.length) return [];
  const rows = (await db.query<CatalogProduct>(`SELECT * FROM (${catalogSql}) catalog WHERE catalog.id=ANY($2::uuid[]) AND ${notSecondaryOffer}`,
    [storefrontCompanies(), ids])).rows;
  return (await withBestOffers(rows)).filter(sellable).sort((a, b) => a.price_kurus! - b.price_kurus! || a.code.localeCompare(b.code, "tr"));
}

/** Keeps the cheapest `perBrandLimit` rows of each brand the store shows, overall order unchanged. */
function limitPerBrand<T extends { display_brand: string }>(rows: T[]) {
  const seen = new Map<string, number>();
  return rows.filter(row => { const n = (seen.get(row.display_brand) ?? 0) + 1; seen.set(row.display_brand, n); return n <= perBrandLimit; });
}

/**
 * Everything the kit builder needs for one vehicle type: per slot, the products linked to the vehicle in that
 * slot's category (engine oil: the oils meeting its recommended spec), each with picture, logo and best price.
 */
export async function maintenanceKitOptions(vehicleTypeId: string): Promise<MaintenanceKitOptions> {
  const [fitted, oilSpec] = await Promise.all([typeFittedIds(Number(vehicleTypeId)), getVehicleOilSpec(vehicleTypeId)]);
  const fittedSet = new Set(fitted);
  // The supplier's code and brand of every candidate: the picture is looked up by those, not by what the store shows.
  const sources = new Map<string, { id: string; code: string; brand: string }>();
  const candidates = (products: CatalogProduct[], spec: VehicleOilSpec | null) => products.map(product => {
    sources.set(product.id, { id: product.id, code: product.code, brand: product.brand });
    return toCandidate(product, spec);
  });
  const slots = await Promise.all(kitSlots.map(async (slot): Promise<KitSlotOptions> => {
    if (slot.key === "engineOil") {
      // Without a grade or an approval to match, any oil would be a guess.
      const filters = oilSpec ? vehicleOilFilters(oilSpec) : [];
      if (!filters.length) return { key: slot.key, candidates: [], oilMatch: "none" };
      let ids = await vehicleOilProductIds(vehicleTypeId, new Set(filters)), oilMatch: KitSlotOptions["oilMatch"] = filters.includes("approval") ? "full" : "viscosity";
      if (!ids.length && filters.length > 1) { ids = await vehicleOilProductIds(vehicleTypeId, new Set(["viscosity"])); oilMatch = "viscosity"; }
      const products = limitPerBrand(await sellableProducts(ids));
      return { key: slot.key, oilMatch: products.length ? oilMatch : "none", candidates: candidates(products, oilSpec) };
    }
    const inCategory = await categoryProductIds([], [slot.categoryId]);
    const products = limitPerBrand(await sellableProducts(inCategory.filter(id => fittedSet.has(id))));
    return { key: slot.key, candidates: candidates(products, null) };
  }));
  const all = slots.flatMap(slot => slot.candidates);
  const [images, logos] = await Promise.all([
    getCatalogProductImages([...sources.values()]),
    getManufacturerLogos([...new Set(all.map(candidate => candidate.brand))]),
  ]);
  for (const candidate of all) { candidate.image = images.get(candidate.id) ?? null; candidate.logo = logos.get(candidate.brand) ?? null; }
  return { slots, oilSpec, oilCapacityLabel: oilSpec ? oilCapacity(oilSpec) : null };
}

function toCandidate(product: CatalogProduct, oilSpec: VehicleOilSpec | null): KitCandidate {
  const packLitres = oilSpec ? oilPackLitres(product.name) : null;
  return {
    id: product.id, offerId: product.offer_id ?? product.id, href: productPath(product), name: shownProductName(product), brand: product.display_brand, code: product.display_code,
    priceKurus: product.price_kurus!, maxQuantity: Math.min(99, product.max_quantity), stockLabel: product.stock_label,
    image: null, logo: null, packLitres,
    suggestedQuantity: oilSpec?.capacityMax ? Math.min(Math.max(1, product.max_quantity), oilPackQuantity(oilSpec.capacityMax, packLitres)) : 1,
  };
}

/**
 * The composite image's pieces: the products' pictures (bucket + key for a direct read) and which kit slot each
 * one fills, derived from the products themselves so the same ids always draw the same picture.
 */
export async function kitImageItems(productIds: string[]) {
  if (!productIds.length) return [];
  const rows = (await db.query<{ id: string; name: string; brand: string; code: string; display_brand: string; category_id: number | null; engine_oil: boolean }>(
    `SELECT catalog.id::text,catalog.name,catalog.brand,catalog.code,catalog.display_brand,
      (SELECT pc.category_id FROM product_source_categories pc JOIN storefront_enrichments e ON e.donor_item_id=pc.supplier_item_id
        WHERE e.supplier_item_id=catalog.id AND pc.source='trodo' AND pc.category_id=ANY($3::int[]) LIMIT 1) AS category_id,
      ((catalog.name ~* $4 OR catalog.name ~* $5) AND catalog.name !~* $6) AS engine_oil
     FROM (${catalogSql}) catalog WHERE catalog.id=ANY($2::uuid[])`,
    [storefrontCompanies(), productIds, kitSlots.filter(slot => slot.key !== "engineOil").map(slot => slot.categoryId),
      engineOilNameSql, plainEngineOilNameSql, notEngineOilNameSql])).rows;
  const byId = new Map(rows.map(row => [row.id, row]));
  const products = productIds.flatMap(id => byId.get(id) ?? []);
  // Looked up by the supplier's code and brand; the store brand (#602) is only returned for display.
  const images = await getCatalogProductImages(products);
  const mediaIds = [...new Set([...images.values()].map(image => image.src.split("/").pop()!))];
  const media = mediaIds.length ? (await db.query<{ id: string; bucket: string; object_key: string; content_type: string }>(
    "SELECT id::text,bucket,object_key,content_type FROM product_media_objects WHERE id=ANY($1::uuid[])", [mediaIds])).rows : [];
  const mediaById = new Map(media.map(row => [row.id, row]));
  return products.map(product => {
    const slot = kitSlots.find(candidate => candidate.categoryId === product.category_id) ?? (product.engine_oil ? kitSlots.find(candidate => candidate.key === "engineOil")! : null);
    const image = images.get(product.id);
    return { id: product.id, name: product.name, brand: product.display_brand, slot, media: image ? mediaById.get(image.src.split("/").pop()!) ?? null : null };
  });
}
