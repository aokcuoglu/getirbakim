import { partialGaps, sourceHosts, type PartialGap, type SourceKey } from "./enrichment-pace";
import type { StatusTone } from "../suppliers/run-status";

export const enrichmentStatuses: Record<string, string> = {
  complete: "Tamamlandı", partial: "Kısmi veri", review: "İnceleme gerekiyor", not_found: "Eşleşme bulunamadı",
  pending: "Bekliyor", blocked: "Erişim engellendi", failed: "Başarısız",
};
/** Badge tone of each enrichment status (table and details dialog). */
export const enrichmentStatusTones: Record<string, StatusTone> = {
  complete: "success", partial: "warning", review: "warning", failed: "error", blocked: "error", not_found: "error", pending: "neutral",
};
export const sourceLabels: Record<string, { name: string; role: string }> = {
  trodo: { name: "Trodo", role: "Birincil kaynak · bekleyen kuyruk" },
  otoparcasan: { name: "otoparcasan", role: "Eşleşmeyen + inceleme · saatlik yedek" },
  spareto: { name: "spareto", role: "Bekleyen kuyruk + saatlik yedek" },
  parts2world: { name: "parts2world", role: "Arşivlenmiş TecDoc ürünleri · tam araç listesi" },
};
export const gapLabels: Record<PartialGap, string> = {
  image: "Görsel yok", no_vehicles: "Araç listesi yok", vehicles_not_collected: "Araçlar toplanmadı",
  unresolved_vehicles: "Araçların bir kısmı eşleşmedi", invalid_rows: "Geçersiz araç satırı", failed_makes: "Bazı markaların araçları alınamadı",
};
export const matchLabels: Record<string, string> = { oem_reference: "OEM referansı", exact_part: "Doğrudan", cross_reference: "Muadil" };
/** The source that wrote a product's data, from its source URL. */
export const dataSource = (url: string | null) => url ? (Object.keys(sourceHosts) as SourceKey[]).find(key => sourceHosts[key] === new URL(url).hostname) ?? null : null;
export const sourceNames = (keys: SourceKey[]) => keys.map(key => sourceLabels[key].name).join(", ");
export const gapText = (row: { status: string; source_method: string | null; image_shown: boolean }) =>
  row.status === "partial" ? partialGaps(row.source_method, row.image_shown).map(gap => gapLabels[gap]).join(" · ") : "";
/** The dashboard's two views: the product records list and the sources overview. */
export const dashboardTabs = ["records", "sources"] as const;
export type DashboardTab = typeof dashboardTabs[number];
export const dashboardTab = (value?: string): DashboardTab => value === "sources" ? "sources" : "records";
