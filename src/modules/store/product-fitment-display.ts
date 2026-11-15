/**
 * A vehicle as the store's product page lists it (src/components/product-fitment.tsx), in the shape
 * getProductEnrichment() gives a linked vehicle: "<make> <model>", the catalog engine name and fuel, MM/YYYY years.
 */
export type StoreVehicle = {
  model: string; engineAndCodes: string; fuel: string; kw: number; ps: number; cc: number; from: string; to: string | null;
  vehicleTypeId: number; brandId: number; modelId: number; catalogEngine: string; catalogBrand: string;
};
/** The admin's vehicle decisions of one product (db/product-override-fitments.sql, #583): added types, removed type ids. */
export type FitmentOverrides = { added: StoreVehicle[]; removed: number[] };

/**
 * The vehicles the store shows: the automatic (enrichment) rows without the types the admin removed, then the added
 * types the automatic rows do not list already, in the order the admin added them.
 */
export function applyFitmentOverrides<T extends { vehicleTypeId: number | null }>(automatic: T[], overrides: FitmentOverrides): (T | StoreVehicle)[] {
  if (!overrides.added.length && !overrides.removed.length) return automatic;
  const removed = new Set(overrides.removed);
  const shown: (T | StoreVehicle)[] = automatic.filter(vehicle => vehicle.vehicleTypeId === null || !removed.has(vehicle.vehicleTypeId));
  const listed = new Set(shown.map(vehicle => vehicle.vehicleTypeId));
  for (const vehicle of overrides.added) if (!listed.has(vehicle.vehicleTypeId)) {
    listed.add(vehicle.vehicleTypeId);
    shown.push(vehicle);
  }
  return shown;
}
