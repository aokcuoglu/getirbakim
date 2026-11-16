import { liveCheckReasonLabel } from "@/modules/admin/order-procurement";

export type OrderNoteLine = { code: string; supplierLabel: string | null; snapshot: Record<string, unknown> | null };

const joinNames = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(", ")} ve ${names[names.length - 1]}` : names[0] ?? "";
const unique = (values: (string | null)[]) => [...new Set(values.filter((value): value is string => Boolean(value)))];

/**
 * Admin-only note on the order page for lines sold from saved supplier data (#766). Names each line's real supplier
 * (or none) and separates "snapshot mode, no live check" from "live check attempted but failed" (#763).
 */
export function snapshotNotes(lines: OrderNoteLine[]): string[] {
  const snapshotLines = lines.filter(line => line.snapshot?.checkout_mode === "snapshot");
  const failed = snapshotLines.filter(line => line.snapshot?.live_check === "failed");
  const recorded = snapshotLines.filter(line => line.snapshot?.live_check !== "failed");
  const notes: string[] = [];
  if (recorded.length) {
    const names = joinNames(unique(recorded.map(line => line.supplierLabel)));
    notes.push(`Kayıtlı veri modu: ${names ? `${names} ürünleri` : "Ürünler"} tedarikçinin kayıtlı fiyat ve stok verileriyle satıldı. Sipariş anında canlı API doğrulaması yapılmadı.`);
  }
  if (failed.length) {
    const detail = failed.map(line => {
      const reason = typeof line.snapshot?.live_check_reason === "string" ? line.snapshot.live_check_reason : "";
      return `${line.code}${line.supplierLabel ? ` (${line.supplierLabel})` : ""} – ${liveCheckReasonLabel[reason] ?? "neden bilinmiyor"}`;
    }).join("; ");
    notes.push(`Canlı doğrulama denendi, başarısız: ${detail}. Bu ürünler kayıtlı fiyat ve stok verisiyle satıldı; tedarikçiyle teyit edilmeli.`);
  }
  return notes;
}
