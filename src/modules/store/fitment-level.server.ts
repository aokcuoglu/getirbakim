import "server-only";
import { db } from "@/lib/db";
import { fitmentLevel, type FitmentLevel, type FitmentVehicle } from "./fitment-level";
import { enrichmentFitmentRows, loadEnrichmentFitments } from "./product-enrichment";
import { getDescriptionModelIds } from "./description-fitment.server";
import { applyFitmentOverrides, emptyFitmentOverrides, modelFallbacks } from "./product-fitment-display";
import { getOverrideFitments } from "./product-fitments";
import type { GarageVehicle } from "./garage";

const catalogTypeId = (vehicle: GarageVehicle) => vehicle.vehicleId && /^\d{1,9}$/.test(vehicle.vehicleId) ? vehicle.vehicleId : null;

/** Resolves the garage vehicle to catalog ids; a free-text vehicle has neither. */
export async function fitmentVehicle(vehicle: GarageVehicle | null): Promise<FitmentVehicle | null> {
  if (!vehicle) return null;
  const typeId = catalogTypeId(vehicle);
  if (!typeId) return { typeId: null, modelId: null };
  const row = (await db.query<{ model_id: string }>("SELECT model_id::text FROM vehicle_types WHERE id=$1", [typeId])).rows[0];
  return { typeId: row ? typeId : null, modelId: row?.model_id ?? null };
}

/** fitmentVehicle of several vehicles in one query, keyed by the garage's type id (catalog ids only). */
export async function fitmentVehicles(vehicles: (GarageVehicle | null)[]): Promise<Map<string, FitmentVehicle>> {
  const typeIds = [...new Set(vehicles.flatMap(vehicle => (vehicle && catalogTypeId(vehicle)) || []))];
  const resolved = new Map<string, FitmentVehicle>(typeIds.map(typeId => [typeId, { typeId: null, modelId: null }]));
  if (!typeIds.length) return resolved;
  const rows = (await db.query<{ id: string; model_id: string }>("SELECT id::text,model_id::text FROM vehicle_types WHERE id=ANY($1::int[])", [typeIds])).rows;
  for (const row of rows) resolved.set(row.id, { typeId: row.id, modelId: row.model_id });
  return resolved;
}

/**
 * Reads everything the fitment level of these lines (`productIds[i]` with `vehicles[i]`) needs in four bulk queries
 * (#708); `level` is then pure. A line without a vehicle needs no data. `level` returns null for a product or a catalog
 * vehicle that was not preloaded.
 */
export async function fitmentLevelResolver(productIds: string[], vehicles: (GarageVehicle | null)[]) {
  const ids = [...new Set(productIds.filter((_, index) => vehicles[index]))];
  const [resolvedVehicles, overridesById, descriptionModels, enrichments] = await Promise.all([
    fitmentVehicles(vehicles), getOverrideFitments(ids), getDescriptionModelIds(ids), loadEnrichmentFitments(ids)]);
  const loaded = new Set(ids);
  return {
    level(product: { id: string; code: string; brand: string }, vehicle: GarageVehicle | null): FitmentLevel | null {
      if (!vehicle) return fitmentLevel(null, []);
      if (!loaded.has(product.id)) return null;
      const typeId = catalogTypeId(vehicle);
      const resolved = typeId ? resolvedVehicles.get(typeId) : { typeId: null, modelId: null };
      if (!resolved) return null;
      const enrichment = enrichmentFitmentRows(enrichments, product);
      const overrides = overridesById.get(product.id) ?? emptyFitmentOverrides();
      // The admin's added types count as linked rows, removed ones leave the list and are a mismatch (#583); hidden unlinked
      // rows leave it too (#661).
      const rows = applyFitmentOverrides(enrichment?.vehicles ?? [], overrides);
      const fallbacks = modelFallbacks(overrides, rows, enrichment?.vehicleModels ?? []);
      if (!fallbacks.description) return fitmentLevel(resolved, rows, overrides.removed);
      // Models read from the supplier's description (#392) name no engine type: at best "likely", never "mismatch".
      return fitmentLevel(resolved, (descriptionModels.get(product.id) ?? []).map(modelId => ({ vehicleTypeId: null, modelId })));
    },
  };
}

/** The fitment level of each line, in order, from one bulk read. */
export async function productFitmentLevels(lines: { product: { id: string; code: string; brand: string }; vehicle: GarageVehicle | null }[]): Promise<FitmentLevel[]> {
  const resolver = await fitmentLevelResolver(lines.map(line => line.product.id), lines.map(line => line.vehicle));
  return lines.map(line => resolver.level(line.product, line.vehicle)!);
}

export async function productFitmentLevel(product: { id: string; code: string; brand: string }, vehicle: GarageVehicle | null): Promise<FitmentLevel> {
  return (await productFitmentLevels([{ product, vehicle }]))[0];
}
