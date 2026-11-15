import "server-only";
import { db } from "@/lib/db";
import { fitmentLevel, type FitmentLevel, type FitmentVehicle } from "./fitment-level";
import { getProductEnrichment } from "./product-enrichment";
import { getDescriptionFitments } from "./description-fitment.server";
import { applyFitmentOverrides } from "./product-fitment-display";
import { getItemFitments } from "./product-fitments";
import type { GarageVehicle } from "./garage";

/** Resolves the garage vehicle to catalog ids; a free-text vehicle has neither. */
export async function fitmentVehicle(vehicle: GarageVehicle | null): Promise<FitmentVehicle | null> {
  if (!vehicle) return null;
  const typeId = vehicle.vehicleId && /^\d{1,9}$/.test(vehicle.vehicleId) ? vehicle.vehicleId : null;
  if (!typeId) return { typeId: null, modelId: null };
  const row = (await db.query<{ model_id: string }>("SELECT model_id::text FROM vehicle_types WHERE id=$1", [typeId])).rows[0];
  return { typeId: row ? typeId : null, modelId: row?.model_id ?? null };
}

export async function productFitmentLevel(product: { id: string; code: string; brand: string }, vehicle: GarageVehicle | null): Promise<FitmentLevel> {
  if (!vehicle) return fitmentLevel(null, []);
  const [resolved, enrichment, overrides] = await Promise.all([fitmentVehicle(vehicle), getProductEnrichment(product), getItemFitments(product.id)]);
  // The admin's added types count as linked rows, removed ones leave the list and are a mismatch (#583).
  const vehicles = applyFitmentOverrides(enrichment?.vehicles ?? [], overrides);
  if (vehicles.length || enrichment?.vehicleModels.length) return fitmentLevel(resolved, vehicles, overrides.removed);
  // Models read from the supplier's description (#392) name no engine type: at best "likely", never "mismatch" (unless
  // an admin removed the selected type).
  return fitmentLevel(resolved, (await getDescriptionFitments(product.id)).map(row => ({ vehicleTypeId: null, modelId: row.modelId })), overrides.removed);
}
