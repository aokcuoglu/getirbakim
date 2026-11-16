/**
 * A vehicle as the store's product page lists it (src/components/product-fitment.tsx), in the shape
 * getProductEnrichment() gives a linked vehicle: "<make> <model>", the catalog engine name and fuel, MM/YYYY years.
 */
export type StoreVehicle = {
  model: string; engineAndCodes: string; fuel: string; kw: number; ps: number; cc: number; from: string; to: string | null;
  vehicleTypeId: number; brandId: number; modelId: number; catalogEngine: string; catalogBrand: string;
};
/**
 * The admin's vehicle decisions of one product (db/product-override-fitments.sql, #583): added types, removed type ids;
 * and the source rows the admin hid (#661): unlinked enrichment vehicles by sourceVehicleKey, model-list entries by text.
 */
export type FitmentOverrides = { added: StoreVehicle[]; removed: number[]; hidden: { vehicles: string[]; models: string[] } };
/** A product without decisions or hidden rows. */
export const emptyFitmentOverrides = (): FitmentOverrides => ({ added: [], removed: [], hidden: { vehicles: [], models: [] } });

/** The source fields of an enrichment vehicle (the payload's, before any catalog link) a hidden unlinked row is stored by. */
export type SourceVehicleFields = { model: string; engineAndCodes: string; fuel: string; kw: number; ps: number; cc: number; from: string; to: string | null; typeId?: number | null };
/**
 * The key of an unlinked enrichment vehicle (product_override_fitment_hides.source_key, #661): its source fields in a
 * fixed order. A source that words the row differently later gives another key; the hidden row then matches nothing.
 */
export const sourceVehicleKey = (vehicle: SourceVehicleFields) =>
  JSON.stringify([vehicle.model, vehicle.engineAndCodes, vehicle.fuel, vehicle.kw, vehicle.ps, vehicle.cc, vehicle.from, vehicle.to, vehicle.typeId ?? null]);

/**
 * The vehicles the store shows: the automatic (enrichment) rows without the types the admin removed and the unlinked
 * rows the admin hid (`sourceKey`), then the added types the automatic rows do not list already, in the order the admin
 * added them.
 */
export function applyFitmentOverrides<T extends { vehicleTypeId: number | null; sourceKey?: string | null }>(automatic: T[], overrides: FitmentOverrides): (T | StoreVehicle)[] {
  if (!overrides.added.length && !overrides.removed.length && !overrides.hidden.vehicles.length) return automatic;
  const removed = new Set(overrides.removed), hidden = new Set(overrides.hidden.vehicles);
  const shown: (T | StoreVehicle)[] = automatic.filter(vehicle => vehicle.vehicleTypeId === null
    ? !(vehicle.sourceKey && hidden.has(vehicle.sourceKey)) : !removed.has(vehicle.vehicleTypeId));
  const listed = new Set(shown.map(vehicle => vehicle.vehicleTypeId));
  for (const vehicle of overrides.added) if (!listed.has(vehicle.vehicleTypeId)) {
    listed.add(vehicle.vehicleTypeId);
    shown.push(vehicle);
  }
  return shown;
}

/**
 * The model-level lists that stand in for engine-level vehicles: the enrichment's vehicleModels without the entries the
 * admin hid (#661) and the models read from the supplier's description (#392). Once the admin decided the product's
 * vehicles (#583) neither applies: they could name a vehicle the admin removed, and a product whose decisions leave no
 * vehicle shows none. Hidden rows are no decision: the description stands in once nothing else is left.
 */
export function modelFallbacks(overrides: FitmentOverrides, vehicles: readonly unknown[], vehicleModels: string[]) {
  const decided = overrides.added.length > 0 || overrides.removed.length > 0;
  const hidden = new Set(overrides.hidden.models);
  const models = decided ? [] : hidden.size ? vehicleModels.filter(model => !hidden.has(model)) : vehicleModels;
  return { vehicleModels: models, description: !decided && !vehicles.length && !models.length };
}
