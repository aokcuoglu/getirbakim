import "server-only";
import { db } from "@/lib/db";
import { enrichmentDataSchema, matchBasisSchema, matchesEnrichment } from "./enrichment-contract";

export type CatalogProductImage = { src: string; width: number; height: number };

// Load only the visible page in one query, without fetching vehicle fitments.
export async function getCatalogProductImages(products: { id: string; code: string; brand: string }[]) {
  const images = new Map<string, CatalogProductImage>();
  if (!products.length) return images;
  const productsById = new Map(products.map(product => [product.id, product]));
  const rows = (await db.query<{
    supplier_item_id: string; supplier_code: string; supplier_brand: string; current_oem: string;
    manufacturer: string; manufacturer_part_number: string; payload: unknown; match_basis: unknown; image_id: string;
  }>(`SELECT e.supplier_item_id,e.supplier_code,e.supplier_brand,e.manufacturer,e.manufacturer_part_number,
      e.payload,e.match_basis,e.image_id,COALESCE(s.product_data->>'oe','') AS current_oem
    FROM product_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id
    JOIN product_media_objects m ON m.id=e.image_id
    WHERE e.supplier_item_id=ANY($1::uuid[]) AND s.presence='present' AND s.company=$2`,
  [products.map(product => product.id), process.env.BASBUG_FIRMA_ADI || "BASBUG"])).rows;
  for (const row of rows) {
    const product = productsById.get(row.supplier_item_id);
    if (!product || row.supplier_code !== product.code || row.supplier_brand !== product.brand) continue;
    const parsed = enrichmentDataSchema.safeParse(row.payload);
    const basis = matchBasisSchema.safeParse(row.match_basis);
    if (!parsed.success || !basis.success || !matchesEnrichment({ ...product, oem: row.current_oem }, {
      manufacturer: row.manufacturer, partNumber: row.manufacturer_part_number, data: parsed.data, matchBasis: basis.data,
    })) continue;
    images.set(product.id, { src: `/api/product-media/${row.image_id}`, width: parsed.data.imageWidth, height: parsed.data.imageHeight });
  }
  return images;
}

// Supplier observations and external content have independent lifecycles.
export async function getProductEnrichment(product: { id: string; code: string; brand: string }) {
  const row = (await db.query<{
    supplier_code: string; supplier_brand: string; source_url: string; match_basis: unknown; current_oem: string;
    manufacturer: string; manufacturer_part_number: string; payload: unknown; image_id: string | null; status: string;
  }>("SELECT e.*,j.status,COALESCE(s.product_data->>'oe','') AS current_oem FROM product_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id LEFT JOIN product_enrichment_jobs j USING(supplier_item_id) WHERE e.supplier_item_id=$1", [product.id])).rows[0];
  if (!row || row.supplier_code !== product.code || row.supplier_brand !== product.brand) return null;
  const parsed = enrichmentDataSchema.safeParse(row.payload);
  const basis = matchBasisSchema.safeParse(row.match_basis);
  if (!parsed.success || !basis.success || !matchesEnrichment({ ...product, oem: row.current_oem }, {
    manufacturer: row.manufacturer, partNumber: row.manufacturer_part_number, data: parsed.data, matchBasis: basis.data,
  })) return null;
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
    WHERE f.supplier_item_id=$1 AND f.source_vehicle=$2::jsonb->'vehicles'->f.source_index`, [product.id, JSON.stringify(row.payload)])).rows;
  const fitmentByIndex = new Map(fitments.map(fitment => [fitment.source_index, fitment]));
  const vehicles = parsed.data.vehicles.map((source, index) => {
    const linked = fitmentByIndex.get(index);
    if (!linked?.vehicle_type_id) return { ...source, vehicleTypeId: null, brandId: null, modelId: null, catalogEngine: null, catalogBrand: null };
    return { ...source, vehicleTypeId: linked.vehicle_type_id, brandId: linked.brand_id, modelId: linked.model_id,
      model: `${linked.brand} ${linked.model}`, catalogEngine: linked.engine, catalogBrand: linked.brand,
      fuel: linked.fuel!, kw: linked.kw!, ps: linked.ps!, cc: linked.cc ?? source.cc, from: linked.from!, to: linked.to };
  });
  return {
    ...parsed.data,
    vehicles,
    linkedVehicleCount: vehicles.filter(vehicle => vehicle.vehicleTypeId !== null).length,
    completeness: row.status,
    matchBasis: basis.data,
    source: row.source_url,
    sourceLabel: new URL(row.source_url).hostname.replace(/^www\./, ""),
    manufacturer: row.manufacturer,
    partNumber: row.manufacturer_part_number,
    imagePath: row.image_id ? `/api/product-media/${row.image_id}` : null,
  };
}
