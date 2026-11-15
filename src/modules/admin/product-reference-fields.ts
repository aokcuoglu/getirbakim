/** Admin-entered reference numbers (db/product-override-references.sql, #582): kinds, labels and history text. */
export const referenceKinds = ["oem", "cross", "ean"] as const;
export type ReferenceKind = (typeof referenceKinds)[number];

export const referenceKindLabels: Record<ReferenceKind, string> = {
  oem: "OEM numarası", cross: "Muadil (çapraz) kod", ean: "Barkod (EAN)",
};
const shortLabels: Record<ReferenceKind, string> = { oem: "OEM", cross: "Muadil", ean: "EAN" };

/** Most rows (added and hidden numbers together) one product keeps. */
export const productReferenceLimit = 200;

export const productReferenceChangeLabels: Record<string, string> = {
  reference_added: "Referans eklendi",
  reference_removed: "Referans kaldırıldı",
  reference_hidden: "Otomatik referans gizlendi",
  reference_shown: "Otomatik referans yeniden gösterildi",
};

/** "OEM · VW · 1K0615301AA"; a barcode has no brand ("EAN · 4006584112301"). */
export function referenceText(kind: ReferenceKind, brand: string, number: string) {
  return [shortLabels[kind], brand, number].filter(Boolean).join(" · ");
}

const isKind = (value: string): value is ReferenceKind => referenceKinds.some(kind => kind === value);

/**
 * History text of a reference change, stored as "kind|brand|number" (the number never holds "|"); null for other
 * fields (the caller formats those).
 */
export function referenceHistoryValue(field: string, value: string | null): string | null {
  if (!(field in productReferenceChangeLabels)) return null;
  if (!value) return "—";
  const first = value.indexOf("|"), last = value.lastIndexOf("|");
  const kind = value.slice(0, first);
  if (first < 0 || first === last || !isKind(kind)) return value;
  return referenceText(kind, value.slice(first + 1, last), value.slice(last + 1));
}
