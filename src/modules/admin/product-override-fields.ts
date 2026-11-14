// Client-safe (no zod): the store card fields an admin can set by hand (db/product-overrides.sql, #575).

/** NULL follows the automatic sources; hidden=false is the automatic state (published). */
export const productOverrideFields = ["name", "description", "seo_title", "seo_description", "category_id", "hidden"] as const;
export type ProductOverrideField = (typeof productOverrideFields)[number];
export type ProductOverrideValues = {
  name: string | null; description: string | null; seo_title: string | null; seo_description: string | null; category_id: number | null; hidden: boolean;
};

export const productOverrideLabels: Record<ProductOverrideField, string> = {
  name: "Mağaza ürün adı",
  description: "Açıklama",
  seo_title: "SEO başlığı",
  seo_description: "SEO açıklaması",
  category_id: "Kategori",
  hidden: "Mağazada görünürlük",
};

/** A save's outcome; on success the stored edits and their version, which the form adopts (product-override-form-state.ts). */
export type ProductOverrideResult = {
  status: "idle" | "success" | "error"; message?: string; reset?: ProductOverrideField; values?: ProductOverrideValues; version?: string;
};

/** Values shown for a field in the change history: NULL is "automatic". */
export function overrideValueText(value: string | number | boolean | null): string | null {
  if (value === null) return null;
  if (typeof value === "boolean") return value ? "Gizli" : "Yayında";
  return String(value);
}
