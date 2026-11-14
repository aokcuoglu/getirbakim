import type { SourceVehicle } from "@/modules/store/fitment-matcher";

type AdminFitmentRow = {
  index: number; source: SourceVehicle; status: string;
  catalog: { typeId: number; brand: string; model: string; engine: string; ps: number; kw: number; cc: number; from: string; to: string | null } | null;
};
export type AdminFitmentDetails = { rows: AdminFitmentRow[]; modelCount: number; total: number; matched: number; filtered: number };

export const fitmentPageSize = 50;
export const fitmentMaxLimit = 200;
export type FitmentFilter = "all" | "matched" | "unmatched";
export const fitmentMaxQuery = 100;
export type FitmentPaging = { offset: number; limit: number; filter: FitmentFilter; query: string };

// Query parameters arrive as untrusted strings; anything but a plain in-range integer is rejected.
export function parseFitmentPaging(params: URLSearchParams): FitmentPaging | null {
  const integer = (name: string, fallback: number, max: number) => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    if (!/^\d{1,9}$/.test(raw)) return null;
    const value = Number(raw);
    return value <= max ? value : null;
  };
  const offset = integer("vehiclesOffset", 0, 10_000_000), limit = integer("vehiclesLimit", fitmentPageSize, fitmentMaxLimit);
  const filter = params.get("vehiclesFilter") ?? "all";
  const query = (params.get("vehiclesQuery") ?? "").trim();
  if (query.length > fitmentMaxQuery) return null;
  if (offset === null || limit === null || limit < 1) return null;
  if (filter !== "all" && filter !== "matched" && filter !== "unmatched") return null;
  return { offset, limit, filter, query };
}
export const fitmentStatusLabels: Record<string, string> = {
  matched: "Eşleşti", model_missing: "Model bulunamadı", attributes_missing: "Teknik değerler eşleşmedi",
  dates_differ: "Üretim tarihi farklı", engine_name_differs: "Motor / çekiş adı farklı", ambiguous: "Birden fazla aday",
  unprocessed: "Henüz eşleştirilmedi", stale: "Yeniden eşleştirme gerekiyor",
};
export const fitmentStatusReasons: Record<string, string> = {
  model_missing: "Kaynak marka/model adı araç kataloğunda doğrudan bulunamadı.",
  attributes_missing: "Model bulundu; yakıt, hacim, PS veya kW değerlerinin tamamı aynı olan araç tipi bulunamadı.",
  dates_differ: "Teknik değerler eşleşiyor; üretim başlangıç veya bitiş ayı farklı.",
  engine_name_differs: "Teknik değerler ve tarihler eşleşiyor; motor adı veya çekiş varyantı farklı.",
  ambiguous: "Aynı bilgilerle birden fazla araç tipi bulunduğu için bağlantı kurulmadı.",
  unprocessed: "Bu kaynak satırı için henüz bir eşleştirme sonucu kaydedilmedi.",
  stale: "Kaynak araç satırı değişmiş; önceki eşleştirme artık bu satıra ait değil.",
};
