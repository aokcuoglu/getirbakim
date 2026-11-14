import { z } from "zod";

/** Store card fields an admin can set by hand (db/product-overrides.sql); NULL follows the automatic sources. */
export const productOverrideFields = ["name", "description", "seo_title", "seo_description", "category_id", "hidden"] as const;
export type ProductOverrideField = (typeof productOverrideFields)[number];

export const productOverrideLabels: Record<ProductOverrideField, string> = {
  name: "Mağaza ürün adı",
  description: "Açıklama",
  seo_title: "SEO başlığı",
  seo_description: "SEO açıklaması",
  category_id: "Kategori",
  hidden: "Mağazada görünürlük",
};

const text = (max: number) => z.string().trim().max(max, `En fazla ${max.toLocaleString("tr-TR")} karakter girin.`)
  .transform(value => value === "" ? null : value);

export const productOverrideValuesSchema = z.object({
  name: text(300),
  description: text(5000),
  seo_title: text(120),
  seo_description: text(300),
  category_id: z.string().trim().refine(value => value === "" || /^\d{1,9}$/.test(value), "Listeden bir kategori seçin.")
    .transform(value => value === "" ? null : Number(value)),
  // The form's "Mağazada yayında" switch: an unchecked switch submits nothing, so a missing value means hidden.
  published: z.string().optional(),
}).transform(({ published, ...values }) => ({ ...values, hidden: published !== "on" }));
export const productOverrideIdSchema = z.uuid();
export type ProductOverrideValues = z.output<typeof productOverrideValuesSchema>;

export type ProductOverrideResult = { status: "idle" | "success" | "error"; message?: string };

/** Values shown for a field in the change history and form: NULL is "automatic". */
export function overrideValueText(value: string | number | boolean | null): string | null {
  if (value === null) return null;
  if (typeof value === "boolean") return value ? "Gizli" : "Yayında";
  return String(value);
}
