import { z } from "zod";

function rate(max: number) {
  return z.string().trim().transform((value, ctx) => {
    if (value === "") return null;
    if (!/^[0-9]+(?:[.,][0-9]{1,2})?$/.test(value)) {
      ctx.addIssue({ code: "custom", message: "En fazla iki ondalık basamaklı bir sayı girin." });
      return z.NEVER;
    }
    const parsed = Number(value.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed > max) {
      ctx.addIssue({ code: "custom", message: `0 – ${max.toLocaleString("tr-TR")} arasında bir oran girin.` });
      return z.NEVER;
    }
    return parsed;
  });
}

export const productPricingRatesSchema = z.object({ markup: rate(1000), vat: rate(100) });
export const productPricingSchema = productPricingRatesSchema.extend({ id: z.uuid() });
export type ProductPricingRates = z.output<typeof productPricingRatesSchema>;
export type ProductPricing = ProductPricingRates & { generalMarkup: number; generalVat: number };
export type ProductPricingResult = { status: "idle" | "success" | "error"; message?: string; rates?: ProductPricingRates };

/** Decimal arithmetic matches PostgreSQL numeric rounding, including half-cent boundaries. */
export function productPricePreview(cost: number | null, markup: number, vat: number): number | null {
  if (cost === null || !Number.isFinite(cost) || cost <= 0 || cost > 21474836.47 || !Number.isFinite(markup) || !Number.isFinite(vat) || markup < 0 || markup > 1000 || vat < 0 || vat > 100) return null;
  const [coefficient, exponent = "0"] = String(cost).split("e");
  const scale = (coefficient.split(".")[1]?.length ?? 0) - Number(exponent);
  const digits = BigInt(coefficient.replace(".", "")) * BigInt(10) ** BigInt(Math.max(0, -scale));
  const numerator = digits * BigInt(10000 + Math.round(markup * 100)) * BigInt(10000 + Math.round(vat * 100)) * BigInt(100);
  const denominator = BigInt(10) ** BigInt(Math.max(0, scale)) * BigInt(100000000);
  const rounded = (BigInt(2) * numerator + denominator) / (BigInt(2) * denominator);
  return rounded >= BigInt(1) && rounded <= BigInt(2147483647) ? Number(rounded) : null;
}
