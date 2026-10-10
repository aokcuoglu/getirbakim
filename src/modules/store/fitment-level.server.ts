import "server-only";
import { db } from "@/lib/db";
import { fitmentLevel, type FitmentLevel, type FitmentVehicle } from "./fitment-level";
import { getProductEnrichment } from "./product-enrichment";
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
  const [resolved, enrichment] = await Promise.all([fitmentVehicle(vehicle), vehicle ? getProductEnrichment(product) : null]);
  return fitmentLevel(resolved, enrichment?.vehicles ?? []);
}
