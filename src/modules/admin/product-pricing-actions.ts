"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { productPricingSchema, type ProductPricingResult } from "./product-pricing-schema";
import { persistProductPricing } from "./product-pricing-store";

export async function saveProductPricing(_previous: ProductPricingResult, form: FormData): Promise<ProductPricingResult> {
  const admin = await requireAdmin();
  const intent = form.get("intent");
  if (intent !== "save" && intent !== "reset") return { status: "error", message: "İşlem tanınmadı. Yeniden deneyin." };
  const input = productPricingSchema.safeParse({ id: form.get("id"), markup: intent === "reset" ? "" : form.get("markup"), vat: intent === "reset" ? "" : form.get("vat") });
  if (!input.success) return { status: "error", message: "Oranları kontrol edin. Kâr 0–1.000, KDV 0–100 aralığında ve en fazla iki ondalık basamaklı olmalıdır." };
  const { id, ...rates } = input.data;
  try {
    if (!await persistProductPricing(db, id, rates, admin.id)) return { status: "error", message: "Dinamik ürün kaydı bulunamadı. Sayfayı yenileyin." };
  } catch {
    return { status: "error", message: "Oranlar kaydedilemedi. Yeniden deneyin." };
  }
  revalidatePath("/", "layout");
  return { status: "success", message: rates.markup === null && rates.vat === null ? "Genel oranlar uygulanıyor." : "Ürüne özel oranlar kaydedildi.", rates };
}
