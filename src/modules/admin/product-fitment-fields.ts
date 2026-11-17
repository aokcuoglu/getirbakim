/** Admin vehicle fitment decisions (db/product-override-fitments.sql, #583): limits, labels and history text. */
import { formatNumber } from "./format";

/**
 * Most decisions (added and removed types together) one product keeps. 1000 (#815): of 93,041 products with fitments
 * the median has 40 types, p90 213, p99 843; 2.6% had more than the earlier 500. A larger source is copied in part.
 */
export const productFitmentLimit = 1000;
/** The admin list shows this many automatic types at most (the rest are counted). */
export const productFitmentAutomaticLimit = 2000;
/**
 * Most engine types one "Araç ekle" adds at once (#662: a whole model can be selected; the largest model has 75 types,
 * 99% of models have at most 37). Copying from another product is bound by productFitmentLimit only.
 */
export const productFitmentBatch = 200;

/** Most vehicle model ids one partial copy sends (#815); vehicle_models has about 5,800 rows. */
export const fitmentCopyModelLimit = 10000;

export { fitmentSourceLabel } from "./product-label";

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
/** The summary row a copy from another product writes after its fitment_added rows (#662); its value is the summary text. */
const copyChangeLabels: Record<string, string> = {
  fitment_copied: "Araç uyumu başka üründen kopyalandı",
};
export const productFitmentChangeLabels: Record<string, string> = { ...typeChangeLabels, ...hideChangeLabels, ...copyChangeLabels };

/** History label of a grouped bulk change (#816): a copy (its summary row), a bulk add, the undo of one (#817). */
export const fitmentBatchLabels: Record<string, string> = {
  fitment_copied: "Araç uyumu başka üründen kopyalandı",
  fitment_added: "Araçlar toplu eklendi",
  fitment_unadded: "Toplu ekleme geri alındı",
};

/** How many named types a grouped history line shows before "ve N tip daha". */
export const fitmentBatchSampleSize = 3;

/**
 * History text of a grouped bulk change (#816): a copy shows its summary row's text; a bulk add or its undo its count
 * and the first types' names ("75 araç tipi: A, B, C ve 72 tip daha"), "Araç tipi <id>" for a type without a name.
 */
export function fitmentBatchSummary(entry: { field: string; count: number; summary: string | null; sample: string[] }, names: ReadonlyMap<string, string>): string {
  if (entry.field === "fitment_copied" && entry.summary) return entry.summary;
  const shown = entry.sample.slice(0, fitmentBatchSampleSize).map(id => names.get(id) ?? `Araç tipi ${id}`);
  const rest = entry.count - shown.length;
  return `${formatNumber(entry.count)} araç tipi${shown.length ? `: ${shown.join(", ")}` : ""}${rest > 0 ? ` ve ${formatNumber(rest)} tip daha` : ""}`;
}

/** Whether a history row is a vehicle type decision (its value is a vehicle type id). */
export const isFitmentChange = (field: string) => Object.hasOwn(typeChangeLabels, field);

/**
 * History text of a fitment change. A type decision is stored as the vehicle type id: the vehicle's name from `names`
 * ("MERCEDES-BENZ 190 (W201) 2.0 · tip 340"), the bare id when the type is unknown. A hidden source row (#661) is
 * stored as the label the admin saw, a copy's summary (#662) as its text. Null for other fields.
 */
export function fitmentHistoryValue(field: string, value: string | null, names: ReadonlyMap<string, string>): string | null {
  if (Object.hasOwn(hideChangeLabels, field) || Object.hasOwn(copyChangeLabels, field)) return value ?? "—";
  if (!isFitmentChange(field)) return null;
  if (!value) return "—";
  const name = names.get(value);
  return name ? `${name} · tip ${value}` : `Araç tipi ${value}`;
}
