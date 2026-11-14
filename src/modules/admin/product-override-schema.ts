import { z } from "zod";
import type { ProductOverrideValues } from "./product-override-fields";

export * from "./product-override-fields";

const text = (max: number) => z.string().trim().max(max, `En fazla ${max.toLocaleString("tr-TR")} karakter girin.`)
  .transform(value => value === "" ? null : value);

/** The "Mağaza bilgileri" form: trimmed text, empty → automatic (NULL). */
export const productOverrideValuesSchema = z.object({
  name: text(300),
  description: text(5000),
  seo_title: text(120),
  seo_description: text(300),
  category_id: z.string().trim().refine(value => value === "" || /^\d{1,9}$/.test(value), "Listeden bir kategori seçin.")
    .transform(value => value === "" ? null : Number(value)),
  // The form's "Mağazada yayında" switch: an unchecked switch submits nothing, so a missing value means hidden.
  published: z.string().optional(),
}).transform(({ published, ...values }): ProductOverrideValues => ({ ...values, hidden: published !== "on" }));
export const productOverrideIdSchema = z.uuid();
