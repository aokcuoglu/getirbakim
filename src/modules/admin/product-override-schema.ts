import { z } from "zod";
import type { ProductCardValues, ProductPriceValues } from "./product-override-fields";

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
}).transform(({ published, ...values }): ProductCardValues => ({ ...values, hidden: published !== "on" }));
export const productOverrideIdSchema = z.uuid();

const maxKurus = 2_147_483_647;

/**
 * Lira as typed: "1249.90", "1249,90" or Turkish grouping "1.249,90" (a dot followed by three digits groups
 * thousands, so "1.249" is 1249 TL), at most two decimals; empty is NULL. Returns whole kuruş, exactly.
 */
export function parseLira(value: string): number | null | "invalid" {
  const text = value.trim();
  if (text === "") return null;
  let whole: string, fraction: string;
  const plain = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text), grouped = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(text);
  if (plain) [whole, fraction] = [plain[1], plain[2] ?? ""];
  else if (grouped) [whole, fraction] = [grouped[1].replace(/\./g, ""), grouped[2] ?? ""];
  else return "invalid";
  whole = whole.replace(/^0+(?=\d)/, "");
  if (whole.length > 8) return "invalid";
  const kurus = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return kurus >= 1 && kurus <= maxKurus ? kurus : "invalid";
}

const lira = z.string().transform((value, ctx) => {
  const parsed = parseLira(value);
  if (parsed === "invalid") {
    ctx.addIssue({ code: "custom", message: "0,01 – 21.474.836,47 TL arasında, en fazla iki ondalıklı bir tutar girin (ör. 1.249,90)." });
    return z.NEVER;
  }
  return parsed;
});

/** A `datetime-local` value ("YYYY-MM-DDTHH:MM", Istanbul time) that names a real minute; empty is NULL. */
const campaignTime = z.string().trim().transform((value, ctx) => {
  if (value === "") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  const [year, month, day, hour, minute] = match ? match.slice(1).map(Number) : [];
  const date = match ? new Date(Date.UTC(year, month - 1, day, hour, minute)) : null;
  if (!date || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59 || year < 2000) {
    ctx.addIssue({ code: "custom", message: "Geçerli bir tarih ve saat seçin." });
    return z.NEVER;
  }
  return value;
});

/**
 * The "Fiyat" form (#580): a fixed price, a campaign price and its window. The campaign needs its price when a date is
 * set, sells below the fixed price and ends after it starts. Whether it has already ended is the store's check (now()).
 */
export const productPriceValuesSchema = z.object({ price: lira, sale_price: lira, sale_from: campaignTime, sale_until: campaignTime })
  .superRefine((values, ctx) => {
    if ((values.sale_from || values.sale_until) && values.sale_price === null)
      ctx.addIssue({ code: "custom", path: ["sale_price"], message: "Kampanya tarihleri için kampanya fiyatı girin." });
    if (values.sale_price !== null && values.price !== null && values.sale_price >= values.price)
      ctx.addIssue({ code: "custom", path: ["sale_price"], message: "Kampanya fiyatı sabit satış fiyatından düşük olmalı." });
    // Same fixed format: the strings order like the times.
    if (values.sale_from && values.sale_until && values.sale_from >= values.sale_until)
      ctx.addIssue({ code: "custom", path: ["sale_until"], message: "Kampanya bitişi başlangıçtan sonra olmalı." });
  })
  .transform((values): ProductPriceValues => ({ price_kurus: values.price, sale_price_kurus: values.sale_price, sale_from: values.sale_from, sale_until: values.sale_until }));
