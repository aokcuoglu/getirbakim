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

/** Outcome of recording a manual return on an order line (#1151). */
export type OrderReturnResult = "recorded" | "unavailable" | "exceeded" | "pending";

/** Units of a line still returnable: ordered minus accepted returns minus quantities held by pending partner requests. */
export function returnRoom(ordered: number, accepted: number, pending: number) {
  return Math.max(0, ordered - accepted - pending);
}

/**
 * Why a return of `quantity` units cannot be recorded, or null when it fits: "exceeded" when it overruns the ordered
 * quantity even without pending partner requests, "pending" when only a pending request holds the missing units.
 */
export function returnRefusal(ordered: number, accepted: number, pending: number, quantity: number): "exceeded" | "pending" | null {
  if (accepted + pending + quantity <= ordered) return null;
  return accepted + quantity > ordered ? "exceeded" : "pending";
}
