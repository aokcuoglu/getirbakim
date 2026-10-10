export const returnReasons = ["not_fit", "wrong_item", "damaged", "defective", "changed_mind", "other"] as const;
export type ReturnReason = typeof returnReasons[number];
export const returnReasonLabels: Record<ReturnReason, string> = {
  not_fit: "Aracıma uymadı",
  wrong_item: "Yanlış ürün gönderildi",
  damaged: "Kargoda hasar gördü",
  defective: "Kusurlu ürün",
  changed_mind: "Vazgeçti",
  other: "Diğer",
};
