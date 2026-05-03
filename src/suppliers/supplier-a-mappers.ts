/**
 * Response mapping helpers for Supplier A (Dinamik Oto) API.
 *
 * Field names are camelCase as returned by the live API.
 * Verified against real API responses on 2026-05-02.
 */

interface DinamikStockItem {
  stokKodu?: string;
  stokAdi?: string;
  marka?: string;
  kull7s?: string;
  kull8s?: string;
  oemListe?: string;
  fiyat?: number;
  resimUrl?: string;
  varyok1?: string;
  varyok2?: string;
  varyok3?: string;
  varyok4?: string;
  varyokAll?: string;
  [key: string]: unknown;
}

interface DinamikPriceItem {
  stokKodu?: string;
  fiyat?: number;
  [key: string]: unknown;
}

export type { DinamikStockItem, DinamikPriceItem };

export function normalizeSupplierAProduct(item: DinamikStockItem): string {
  return item.stokAdi ?? item.stokKodu ?? "";
}

export function normalizeSupplierAPrice(item: DinamikStockItem | DinamikPriceItem): number {
  const price = item.fiyat;
  if (typeof price === "number" && Number.isFinite(price) && price >= 0) return price;
  return 0;
}

export function normalizeSupplierAStock(item: DinamikStockItem): number {
  const available = item.varyokAll ?? item.varyok1;
  if (typeof available === "string" && available.trim().toUpperCase() === "VAR") return 1;
  return 0;
}

export function normalizeOemNumbers(item: DinamikStockItem): string[] {
  const raw = item.oemListe;
  if (!raw || typeof raw !== "string" || !raw.trim()) return [];
  return raw
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeCurrency(): string {
  return "TRY";
}

export function normalizeAvailability(stockQuantity: number): boolean {
  return stockQuantity > 0;
}