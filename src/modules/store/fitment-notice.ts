import type { FitmentLevel, FitmentVehicle } from "./fitment-level";

/**
 * A product page may say the garage vehicle is "not in the list" although fitmentLevel() answers "unknown": a single
 * unlinked source row makes the level unknown (that row may describe the vehicle), so a product with 14 linked and
 * 5 unlinked LADA rows reads "unverified" for a Golf. The claim is safe when the vehicle is a catalog one, the product
 * lists vehicles at all, and none of the unlinked rows belongs to the vehicle's make. Order-side fitmentLevel() is
 * unchanged; this only sharpens the notice.
 */
export function vehicleNotListed(input: { level: FitmentLevel | null; vehicle: FitmentVehicle | null; vehicleMake: string; listed: number; unlinkedMakes: string[] }): boolean {
  if (input.level !== "unknown" || !input.vehicle?.typeId || !input.vehicle.modelId || input.listed <= 0) return false;
  const make = input.vehicleMake.toLocaleUpperCase("tr-TR");
  return !input.unlinkedMakes.some(unlinked => unlinked.toLocaleUpperCase("tr-TR") === make);
}
