/** Admin vehicle fitment decisions (db/product-override-fitments.sql, #583): limits, labels and history text. */

/** Most decisions (added and removed types together) one product keeps. */
export const productFitmentLimit = 500;
/** The admin list shows this many automatic types at most (the rest are counted). */
export const productFitmentAutomaticLimit = 2000;
/** Most engine types one "Araç ekle" adds at once. */
export const productFitmentBatch = 50;

/** Most source rows (unlinked vehicles, model-list entries, description models together) one product hides (#661). */
export const productFitmentHideLimit = 500;

/** What a hidden source row is (product_override_fitment_hides.kind, #661). */
export type FitmentHideKind = "source_vehicle" | "source_model" | "description_model";
const hideFieldNames: Record<FitmentHideKind, string> = { source_vehicle: "vehicle", source_model: "model", description_model: "description" };
/** The history field of hiding a source row or showing it again (db/product-override-fitments.sql writes the same on a merge). */
export const fitmentHideField = (kind: FitmentHideKind, change: "hidden" | "shown") => `fitment_${hideFieldNames[kind]}_${change}`;

const typeChangeLabels: Record<string, string> = {
  fitment_added: "Araç eklendi",
  fitment_removed: "Otomatik araç çıkarıldı",
  fitment_unadded: "Elle eklenen araç kaldırıldı",
  fitment_restored: "Otomatik araç yeniden gösterildi",
};
const hideChangeLabels: Record<string, string> = {
  fitment_vehicle_hidden: "Kaynak araç satırı çıkarıldı",
  fitment_vehicle_shown: "Kaynak araç satırı yeniden gösterildi",
  fitment_model_hidden: "Kaynak model listesinden çıkarıldı",
  fitment_model_shown: "Kaynak model listesinde yeniden gösterildi",
  fitment_description_hidden: "Açıklamadan okunan model çıkarıldı",
  fitment_description_shown: "Açıklamadan okunan model yeniden gösterildi",
};
export const productFitmentChangeLabels: Record<string, string> = { ...typeChangeLabels, ...hideChangeLabels };

/** Whether a history row is a vehicle type decision (its value is a vehicle type id). */
export const isFitmentChange = (field: string) => Object.hasOwn(typeChangeLabels, field);

/**
 * History text of a fitment change. A type decision is stored as the vehicle type id: the vehicle's name from `names`
 * ("MERCEDES-BENZ 190 (W201) 2.0 · tip 340"), the bare id when the type is unknown. A hidden source row (#661) is
 * stored as the label the admin saw. Null for other fields.
 */
export function fitmentHistoryValue(field: string, value: string | null, names: ReadonlyMap<string, string>): string | null {
  if (Object.hasOwn(hideChangeLabels, field)) return value ?? "—";
  if (!isFitmentChange(field)) return null;
  if (!value) return "—";
  const name = names.get(value);
  return name ? `${name} · tip ${value}` : `Araç tipi ${value}`;
}
