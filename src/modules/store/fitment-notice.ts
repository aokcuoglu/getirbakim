import type { FitmentLevel, FitmentVehicle } from "./fitment-level";

/**
 * A product page may say the garage vehicle is "not in the list" although fitmentLevel() answers "unknown": a single
 * unlinked source row makes the level unknown (that row may describe the vehicle), so a product with 14 linked and
 * 5 unlinked LADA rows reads "unverified" for a Golf. The claim is safe when the vehicle is a catalog one, the product
 * lists vehicles at all, and none of the unlinked rows belongs to the vehicle's make. Order-side fitmentLevel() is
 * unchanged; this only sharpens the notice.
 *
 * Makes are compared by their first word, upper-cased like fitmentLabels, so sibling names ("FORD OTOSAN", "FORD USA",
 * "MINI (GB)") count as the garage's make: the cautious side. Pairs with a different first word (VAUXHALL/OPEL) are not
 * recognised and may still be claimed.
 */
const firstWord = (make: string) => make.trim().toUpperCase().split(/\s+/)[0] ?? "";

export function vehicleNotListed(input: { level: FitmentLevel | null; vehicle: FitmentVehicle | null; vehicleMake: string; listed: number; unlinkedMakes: string[] }): boolean {
  if (input.level !== "unknown" || !input.vehicle?.typeId || !input.vehicle.modelId || input.listed <= 0) return false;
  const make = firstWord(input.vehicleMake);
  return !input.unlinkedMakes.some(unlinked => firstWord(unlinked) === make);
}

/**
 * The notice's inputs from the page's data. Only the enrichment's own lists (engine-level rows and the model names)
 * count as a list: the models read from the supplier's description (#392) are a deliberately incomplete list, which can
 * at best make a vehicle "likely", so they never support "not listed".
 */
export function notListedInput(input: { level: FitmentLevel | null; vehicle: FitmentVehicle | null; vehicleMake: string;
  rows: { model: string; modelId: number | null }[]; vehicleModels: string[]; makeOf: (text: string) => string }) {
  return {
    level: input.level, vehicle: input.vehicle, vehicleMake: input.vehicleMake,
    listed: input.rows.length + input.vehicleModels.length,
    unlinkedMakes: [...input.rows.filter(row => row.modelId === null).map(row => input.makeOf(row.model)), ...input.vehicleModels.map(input.makeOf)],
  };
}
