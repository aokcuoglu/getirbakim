/** Admin vehicle fitment decisions (db/product-override-fitments.sql, #583): limits, labels and history text. */

/** Most decisions (added and removed types together) one product keeps. */
export const productFitmentLimit = 500;
/** The admin list shows this many automatic types at most (the rest are counted). */
export const productFitmentAutomaticLimit = 2000;
/** Most engine types one "Araç ekle" adds at once. */
export const productFitmentBatch = 50;

export const productFitmentChangeLabels: Record<string, string> = {
  fitment_added: "Araç eklendi",
  fitment_removed: "Otomatik araç çıkarıldı",
  fitment_unadded: "Elle eklenen araç kaldırıldı",
  fitment_restored: "Otomatik araç yeniden gösterildi",
};

/** Whether a history row is a fitment decision (its value is a vehicle type id). */
export const isFitmentChange = (field: string) => Object.hasOwn(productFitmentChangeLabels, field);

/**
 * History text of a fitment change, stored as the vehicle type id: the vehicle's name from `names`
 * ("MERCEDES-BENZ 190 (W201) 2.0 · tip 340"), the bare id when the type is unknown. Null for other fields.
 */
export function fitmentHistoryValue(field: string, value: string | null, names: ReadonlyMap<string, string>): string | null {
  if (!isFitmentChange(field)) return null;
  if (!value) return "—";
  const name = names.get(value);
  return name ? `${name} · tip ${value}` : `Araç tipi ${value}`;
}
