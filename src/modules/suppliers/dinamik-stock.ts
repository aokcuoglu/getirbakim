// Isomorphic: shared by the admin list query and its client-side filters.
// Regional VAR/YOK flags of a Dinamik stock-list row. The city mapping of varyok1..4 comes from the previous
// integration; varyokAll is Dinamik's own overall flag and can be VAR while every city says YOK.
export const dinamikRegions = [
  { key: "varyok1", label: "İstanbul", short: "İST" },
  { key: "varyok2", label: "Ankara", short: "ANK" },
  { key: "varyok3", label: "Sakarya", short: "SAK" },
  { key: "varyok4", label: "Kayseri", short: "KAY" },
  { key: "varyokAll", label: "Genel", short: "GENEL" },
] as const;
export type DinamikRegionKey = (typeof dinamikRegions)[number]["key"];
export type DinamikStockData = Partial<Record<DinamikRegionKey | "kaporta", string | null>>;

export function dinamikRegion(value: string | undefined): DinamikRegionKey | "any" {
  return dinamikRegions.some(region => region.key === value) ? value as DinamikRegionKey : "any";
}

/** true = VAR, false = YOK, null = no stock-list row or an unexpected value. */
export function dinamikRegionStock(stock: DinamikStockData | null, key: DinamikRegionKey): boolean | null {
  const value = stock?.[key]?.trim().toUpperCase();
  return value === "VAR" ? true : value === "YOK" ? false : null;
}
