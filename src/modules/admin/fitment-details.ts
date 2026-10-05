import type { SourceVehicle } from "@/modules/store/fitment-matcher";

export type AdminFitmentRow = {
  index: number; source: SourceVehicle; status: string;
  catalog: { typeId: number; brand: string; model: string; engine: string; ps: number; kw: number; cc: number; from: string; to: string | null } | null;
};
export type AdminFitmentDetails = { rows: AdminFitmentRow[]; modelCount: number };
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
