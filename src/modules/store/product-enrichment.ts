import "server-only";
import { db } from "@/lib/db";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { enrichmentDataSchema, matchBasisSchema, matchesEnrichment } from "./enrichment-contract";
import {catalogSpecifications} from "./catalog-filters";
import {displaySpecifications,type CardSpecification} from "./specification-translations";
import { getOverrideImages } from "./product-images";
import { applySpecOverrides } from "./product-spec-display";
import { getOverrideSpecs } from "./product-specs";
import type { FitmentRow } from "./fitment-level";

export type CatalogProductImage = { src: string; width: number; height: number };

/**
 * The image cards, the cart and the partner API show per store row (#581): the product's first admin upload, else its
 * automatic enrichment image unless the admin hid it. Rows with neither are left out (the caller draws PartArt).
 */
export async function getCatalogProductImages(products: { id: string; code: string; brand: string }[]) {
  const [automatic, uploads] = await Promise.all([getAutomaticProductImages(products), getOverrideImages(products.map(product => product.id))]);
  const images = new Map<string, CatalogProductImage>();
  for (const product of products) {
    const own = uploads.get(product.id);
    const image = own?.images[0] ?? (own?.hideAutomatic ? undefined : automatic.get(product.id));
    if (image) images.set(product.id, image);
  }
  return images;
}

// The enrichment image of the visible page in one query, without fetching vehicle fitments.
export async function getAutomaticProductImages(products: { id: string; code: string; brand: string }[]) {
  const images = new Map<string, CatalogProductImage>();
  if (!products.length) return images;
  const productsById = new Map(products.map(product => [product.id, product]));
  const rows = (await db.query<{
    supplier_item_id: string; supplier_code: string; supplier_brand: string; current_oem: string; donor_code: string; donor_brand: string; donor_item_id: string; donor_master_brand: string | null;
    manufacturer: string; manufacturer_part_number: string; payload: unknown; match_basis: unknown; image_id: string;
  }>(`SELECT e.supplier_item_id,e.supplier_code,e.supplier_brand,e.manufacturer,e.manufacturer_part_number,
      e.payload,e.match_basis,e.image_id,e.donor_code,e.donor_brand,e.donor_item_id,e.donor_master_brand,e.donor_oem AS current_oem
    FROM storefront_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id
    JOIN product_media_objects m ON m.id=e.image_id
    WHERE e.supplier_item_id=ANY($1::uuid[]) AND s.presence='present' AND s.company=ANY($2::text[])`,
  [products.map(product => product.id), storefrontCompanies()])).rows;
  for (const row of rows) {
    const product = productsById.get(row.supplier_item_id);
    const valid = product && validEnrichment(row, product);
    if (!product || !valid) continue;
    images.set(product.id, { src: `/api/product-media/${row.image_id}`, width: valid.data.imageWidth, height: valid.data.imageHeight });
  }
  return images;
}

// Supplier observations and external content have independent lifecycles.
export async function getProductEnrichment(product: { id: string; code: string; brand: string }) {
  const row = (await db.query<{
    supplier_code: string; supplier_brand: string; source_url: string; match_basis: unknown; current_oem: string; donor_code: string; donor_brand: string; donor_item_id: string; donor_master_brand: string | null;
    manufacturer: string; manufacturer_part_number: string; payload: unknown; image_id: string | null; status: string;
  }>("SELECT e.*,e.donor_oem AS current_oem FROM storefront_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id WHERE e.supplier_item_id=$1", [product.id])).rows[0];
  const valid = validEnrichment(row, product);
  if (!row || !valid) return null;
  const { data, basis } = valid;
  const fitments = (await db.query<{
    source_index: number; vehicle_type_id: number | null; brand_id: number | null; model_id: number | null;
    brand: string | null; model: string | null; engine: string | null; fuel: string | null;
    kw: number | null; ps: number | null; cc: number | null; from: string | null; to: string | null;
  }>(`SELECT f.source_index,f.vehicle_type_id,m.brand_id,v.model_id,b.display_name AS brand,m.name AS model,
    v.name AS engine,v.fuel_type AS fuel,v.kwt AS kw,v.hp AS ps,v.cc,
    to_char(v.year_of_constr_from,'MM/YYYY') AS "from",to_char(v.year_of_constr_to,'MM/YYYY') AS "to"
    FROM product_vehicle_fitments f
    LEFT JOIN vehicle_types v ON v.id=f.vehicle_type_id
    LEFT JOIN vehicle_models m ON m.id=v.model_id
    LEFT JOIN vehicle_brands b ON b.id=m.brand_id
    WHERE f.supplier_item_id=$1 AND f.source_vehicle=$2::jsonb->'vehicles'->f.source_index`, [row.donor_item_id, JSON.stringify(row.payload)])).rows;
  const fitmentByIndex = new Map(fitments.map(fitment => [fitment.source_index, fitment]));
  const vehicles = data.vehicles.map((source, index) => {
    const linked = fitmentByIndex.get(index);
    if (!linked?.vehicle_type_id) return { ...source, vehicleTypeId: null, brandId: null, modelId: null, catalogEngine: null, catalogBrand: null };
    return { ...source, vehicleTypeId: linked.vehicle_type_id, brandId: linked.brand_id, modelId: linked.model_id,
      model: `${linked.brand} ${linked.model}`, catalogEngine: linked.engine, catalogBrand: linked.brand,
      fuel: linked.fuel!, kw: linked.kw!, ps: linked.ps!, cc: linked.cc ?? source.cc, from: linked.from!, to: linked.to };
  });
  return {
    ...data,
    vehicles,
    linkedVehicleCount: vehicles.filter(vehicle => vehicle.vehicleTypeId !== null).length,
    completeness: row.status,
    matchBasis: basis,
    source: row.source_url,
    sourceLabel: new URL(row.source_url).hostname.replace(/^www\./, ""),
    manufacturer: row.manufacturer,
    partNumber: row.manufacturer_part_number,
    imagePath: row.image_id ? `/api/product-media/${row.image_id}` : null,
  };
}

type EnrichmentGateRow = {
  supplier_code: string; supplier_brand: string; match_basis: unknown; current_oem: string; donor_code: string; donor_brand: string;
  donor_master_brand: string | null; manufacturer: string; manufacturer_part_number: string; payload: unknown;
};
type LinkedFitment = { vehicleTypeId: number; modelId: number | null };
/** The enrichment rows and linked fitments of several store rows (loadEnrichmentFitments), checked per product later. */
export type LoadedEnrichmentFitments = { rows: Map<string, EnrichmentGateRow>; linked: Map<string, Map<number, LinkedFitment>> };

/** The parsed enrichment data and match basis the store shows for this product; null when the row fails any check. */
function validEnrichment(row: EnrichmentGateRow | undefined, product: { code: string; brand: string }) {
  if (!row || row.supplier_code !== product.code || row.supplier_brand !== product.brand) return null;
  const parsed = enrichmentDataSchema.safeParse(row.payload);
  const basis = matchBasisSchema.safeParse(row.match_basis);
  if (!parsed.success || !basis.success || !matchesEnrichment({ code: row.donor_code, brand: row.donor_brand, oem: row.current_oem, masterBrand: row.donor_master_brand }, {
    manufacturer: row.manufacturer, partNumber: row.manufacturer_part_number, data: parsed.data, matchBasis: basis.data,
  })) return null;
  return { data: parsed.data, basis: basis.data };
}

/**
 * The enrichment rows and catalog-linked fitments of several store rows in two queries (#708), from the same source as
 * getProductEnrichment. The code/brand and payload checks are left to enrichmentFitmentRows.
 */
export async function loadEnrichmentFitments(productIds: string[]): Promise<LoadedEnrichmentFitments> {
  const loaded: LoadedEnrichmentFitments = { rows: new Map(), linked: new Map() };
  if (!productIds.length) return loaded;
  const [enrichments, fitments] = await Promise.all([
    db.query<EnrichmentGateRow & { supplier_item_id: string }>(`SELECT e.supplier_item_id::text,e.supplier_code,e.supplier_brand,e.match_basis,
      e.donor_code,e.donor_brand,e.donor_master_brand,e.manufacturer,e.manufacturer_part_number,e.payload,e.donor_oem AS current_oem
      FROM storefront_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id WHERE e.supplier_item_id=ANY($1::uuid[])`, [productIds]),
    // OFFSET 0 keeps the subquery apart so payload->'vehicles' is read once per product. Inlined, the planner detoasts
    // the whole payload for every fitment row (12 heavy products: 27 s instead of 30 ms).
    db.query<{ supplier_item_id: string; source_index: number; vehicle_type_id: number; model_id: number | null }>(
      `SELECT d.supplier_item_id::text,f.source_index,f.vehicle_type_id,v.model_id
       FROM (SELECT l.supplier_item_id,l.donor_item_id,e.payload->'vehicles' AS vehicles
             FROM product_enrichment_shared_links l JOIN product_enrichments e ON e.supplier_item_id=l.donor_item_id
             WHERE l.supplier_item_id=ANY($1::uuid[]) OFFSET 0) d
       JOIN product_vehicle_fitments f ON f.supplier_item_id=d.donor_item_id AND f.vehicle_type_id IS NOT NULL
        AND f.source_vehicle=d.vehicles->f.source_index
       LEFT JOIN vehicle_types v ON v.id=f.vehicle_type_id`, [productIds]),
  ]);
  for (const { supplier_item_id: id, ...row } of enrichments.rows) loaded.rows.set(id, row);
  for (const row of fitments.rows) {
    const byIndex = loaded.linked.get(row.supplier_item_id) ?? new Map<number, LinkedFitment>();
    byIndex.set(row.source_index, { vehicleTypeId: row.vehicle_type_id, modelId: row.model_id });
    loaded.linked.set(row.supplier_item_id, byIndex);
  }
  return loaded;
}

/**
 * The fitment rows getProductEnrichment gives one product (`vehicles` keeps every source vehicle, unlinked ones with
 * null ids) and its model-level list; null when the store shows no enrichment for it.
 */
export function enrichmentFitmentRows(loaded: LoadedEnrichmentFitments, product: { id: string; code: string; brand: string }) {
  const valid = validEnrichment(loaded.rows.get(product.id), product);
  if (!valid) return null;
  const { data } = valid;
  const linked = loaded.linked.get(product.id);
  const vehicles: FitmentRow[] = data.vehicles.map((_, index) => linked?.get(index) ?? { vehicleTypeId: null, modelId: null });
  return { vehicles, vehicleModels: data.vehicleModels };
}

export async function getCatalogProductDetails(products:{id:string;code:string;brand:string}[]){
 const details=new Map<string,{specifications:[string,string][];card:CardSpecification[];vehicleSpecific:boolean;partNumber:string}>();
 if(!products.length)return details;
 // The enrichment is matched by the supplier's raw code and brand (#602); the admin's specifications (#603) apply on top.
 const [{rows},overrides]=await Promise.all([db.query<{supplier_item_id:string;supplier_code:string;supplier_brand:string;current_oem:string;donor_code:string;donor_brand:string;donor_item_id:string;donor_master_brand:string|null;manufacturer:string;manufacturer_part_number:string;payload:unknown;match_basis:unknown}>("SELECT e.*,e.donor_oem AS current_oem FROM storefront_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id WHERE e.supplier_item_id=ANY($1::uuid[]) AND s.company=ANY($2::text[]) AND s.presence='present'",[products.map(p=>p.id),storefrontCompanies()]),getOverrideSpecs(products.map(p=>p.id))]);
 for(const row of rows){
  const product=products.find(p=>p.id===row.supplier_item_id),valid=product&&validEnrichment(row,product);
  if(!product||!valid)continue;
  const{data,basis}=valid;
  details.set(product.id,{specifications:catalogSpecifications(data.specifications,basis.type==='exact_part'),card:[],vehicleSpecific:data.vehicles.length>0,partNumber:basis.type==='exact_part'?row.manufacturer_part_number:product.code});
 }
 for(const product of products){
  const own=overrides.get(product.id);
  if(!own)continue;
  const detail=details.get(product.id);
  const specifications=applySpecOverrides(detail?.specifications??[],own);
  if(detail)details.set(product.id,{...detail,specifications});
  // A product without (matching) enrichment shows the specifications the admin added.
  else if(specifications.length)details.set(product.id,{specifications,card:[],vehicleSpecific:false,partNumber:product.code});
 }
 // Cards show the translated pairs; `specifications` keeps the raw keys the compare table and filters match on (#700).
 for(const detail of details.values())detail.card=displaySpecifications(detail.specifications);
 return details;
}
