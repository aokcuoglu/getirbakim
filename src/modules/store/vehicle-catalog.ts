export type VehicleBrand = { id: string; name: string; popular: boolean };
export type VehicleModel = {
  id: string; brandId: string; name: string; dateFrom: string | null; dateTo: string | null;
};
export type CatalogVehicle = {
  id: string; modelId: string; brandId: string; make: string; model: string; generation: string;
  from: number; to: number; dateFrom: string; dateTo: string | null;
  fuel: string; engine: string; power: string; cc: number | null;
};
export type SavedVehicle = {
  make: string; model: string; year: number; vehicleId?: string;
  generation?: string; fuel?: string; engine?: string; power?: string;
};
export type VehicleCatalogResponse = {
  brands?: VehicleBrand[]; models?: VehicleModel[]; vehicles?: CatalogVehicle[]; total?: number;
};

export function vehicleDetails(vehicle: CatalogVehicle, year: number): SavedVehicle {
  return { make: vehicle.make, model: vehicle.model, year, vehicleId: vehicle.id,
    generation: vehicle.generation, fuel: vehicle.fuel, engine: vehicle.engine, power: vehicle.power };
}

export function normalizeVehicleSearch(value: string) {
  return value.toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
}

export function matchesVehicleSearch(query: string, ...values: string[]) {
  const haystack = normalizeVehicleSearch(values.join(" "));
  return normalizeVehicleSearch(query).trim().split(/\s+/).every(term => haystack.includes(term));
}

export function vehicleProductionDates(dateFrom: string | null, dateTo: string | null) {
  const format = (date: string) => date.split("-").reverse().join(".");
  return `${dateFrom ? format(dateFrom) : "Başlangıç bilinmiyor"} – ${dateTo ? format(dateTo) : "devam ediyor"}`;
}
