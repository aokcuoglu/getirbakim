export const fitmentLevels = ["guaranteed", "likely", "mismatch", "unknown", "no_vehicle"] as const;
export type FitmentLevel = typeof fitmentLevels[number];
export const fitmentLevelLabels: Record<FitmentLevel, string> = {
  guaranteed: "Araç tipine bağlı",
  likely: "Model eşleşiyor, motor tipi doğrulanmadı",
  mismatch: "Seçili araç uyumluluk listesinde yok",
  unknown: "Uyumluluk bilgisi yok",
  no_vehicle: "Araç seçilmedi",
};
export type FitmentVehicle = { typeId: string | null; modelId: string | null };
export type FitmentRow = { vehicleTypeId: number | null; modelId: number | null };

/**
 * "guaranteed" needs a strict catalog link to the selected engine type. "mismatch" is only
 * claimed when every source row is linked, because an unlinked row may describe this vehicle,
 * or when an admin removed the selected type from the product (`removed`, #583).
 */
export function fitmentLevel(vehicle: FitmentVehicle | null, rows: FitmentRow[], removed: number[] = []): FitmentLevel {
  if (!vehicle) return "no_vehicle";
  if (vehicle.typeId && rows.some(row => String(row.vehicleTypeId) === vehicle.typeId)) return "guaranteed";
  if (vehicle.typeId && removed.some(id => String(id) === vehicle.typeId)) return "mismatch";
  if (!rows.length) return "unknown";
  if (vehicle.modelId && rows.some(row => String(row.modelId) === vehicle.modelId)) return "likely";
  if (!vehicle.typeId || rows.some(row => row.vehicleTypeId === null)) return "unknown";
  return "mismatch";
}
