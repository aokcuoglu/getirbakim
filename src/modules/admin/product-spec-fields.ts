import { specificationLabel } from "@/modules/store/catalog-filters";

/** Admin-entered technical specifications (db/product-override-specs.sql, #603): limits, labels and history text. */

/** Most rows (set and hidden keys together) one product keeps. */
export const productSpecLimit = 100;

export const productSpecChangeLabels: Record<string, string> = {
  spec_set: "Özellik kaydedildi",
  spec_hidden: "Otomatik özellik gizlendi",
  spec_removed: "Elle özellik kaldırıldı",
  spec_shown: "Otomatik özellik yeniden gösterildi",
};

/**
 * History text of a specification change, stored as "key|value" (a hidden key has no value; a key never holds "|"):
 * "Montaj konumu: Front Axle". Null for other fields (the caller formats those).
 */
export function specHistoryValue(field: string, value: string | null): string | null {
  if (!Object.hasOwn(productSpecChangeLabels, field)) return null;
  if (!value) return "—";
  const split = value.indexOf("|");
  if (split < 0) return specificationLabel(value);
  return `${specificationLabel(value.slice(0, split))}: ${value.slice(split + 1)}`;
}
