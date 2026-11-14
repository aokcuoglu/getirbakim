import { formatInterval } from "../admin/format";

// One vocabulary for supplier runs (supplier_imports) on every supplier page and the overview: a run is a "çekim".

export type StatusTone = "success" | "warning" | "error" | "info" | "neutral";

export const runStatusLabels: Record<string, string> = { running: "Çalışıyor", succeeded: "Başarılı", failed: "Başarısız", rejected: "İnceleme gerekli" };
export const runStatusTones: Record<string, StatusTone> = { running: "info", succeeded: "success", failed: "error", rejected: "warning" };
export const runStatusLabel = (status: string) => runStatusLabels[status] ?? status;
export const runStatusTone = (status: string): StatusTone => runStatusTones[status] ?? "neutral";

/** Rows of the run history table on every API supplier page. */
export const supplierRunHistoryLimit = 12;

/** "Tam liste" or the price · stock run; Başbuğ's also refreshes the currency rates. */
export function runKindLabel(kind: string | null | undefined, supplier?: string) {
  if (kind !== "commerce") return "Tam liste";
  return supplier === "basbug" ? "Fiyat · stok · kur" : "Fiyat · stok";
}

/** SETA's single scope is stored as "ALL". */
export const runScopeLabel = (listGroup: string) => listGroup === "ALL" ? "Tüm liste" : listGroup;

type ScheduleScope = {
  enabled: boolean; interval_minutes: number; daily_at?: string | null;
  commerce_enabled: boolean; commerce_interval_minutes: number;
};

const mostCommon = (values: string[]) => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
};

/**
 * The automatic plan read from supplier_sync_scopes, e.g. ["Ürün listesi her gün 03:00", "Fiyat · stok 30 dakikada bir"].
 * Scopes usually share one plan; when they differ the most common one is named.
 */
export function scheduleLines(scopes: ScheduleScope[], { catalogLabel = "Ürün listesi", commerceLabel = "Fiyat · stok" } = {}) {
  const catalog = mostCommon(scopes.filter(scope => scope.enabled).map(scope => formatInterval(scope.interval_minutes, scope.interval_minutes === 1440 ? scope.daily_at : null)));
  const commerce = mostCommon(scopes.filter(scope => scope.commerce_enabled).map(scope => formatInterval(scope.commerce_interval_minutes)));
  return [
    catalog ? `${catalogLabel} ${catalog}` : `${catalogLabel}: otomatik çekim kapalı`,
    ...(commerce ? [`${commerceLabel} ${commerce}`] : []),
  ];
}
