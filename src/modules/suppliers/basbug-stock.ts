// Depot codes in the current StokGetir / TopluMalzemeAra contract.
export const basbugWarehouses = ["MRK", "IZM", "IAN", "TRK", "KYS"] as const;
export type BasbugWarehouse = typeof basbugWarehouses[number];
export type BasbugStockData = {
  stok?: number; sYol?: number; sDepo?: string; sFarkliDepo?: number;
  depolar?: Record<string, { stok: number; sYol: number }>;
};

export function basbugWarehouse(value?: string): BasbugWarehouse {
  return basbugWarehouses.find(depot => depot === value) ?? "MRK";
}

export function basbugWarehouseStock(stock: BasbugStockData | null, depot: string): number | null {
  // Older imports only contain the MRK result. Never infer another depot from sDepo.
  const value = stock?.depolar?.[depot]?.stok ?? (depot === "MRK" ? stock?.stok : undefined);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function basbugStockLabel(value: number | null): string {
  return value === null ? "Veri yok" : value > 0 ? "Stok var" : "Stok yok";
}
