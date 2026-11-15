"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { invalidateListings } from "@/modules/store/listing-epoch";
import { syncEnrichmentLinks } from "@/modules/store/enrichment-links.server";
import * as store from "@/modules/admin/product-fitment-store";
import { productFitmentBatch, productFitmentLimit } from "@/modules/admin/product-fitment-fields";

/** Result of a vehicle fitment change (#583); the manager shows the message and refreshes the page. */
export type ProductFitmentActionResult = { status: "success" | "error"; message: string };

const failures: Record<Exclude<store.ProductFitmentResult, { ok: true }>["reason"], string> = {
  "not-found": "Ürün bulunamadı.",
  merged: "Bu ürün başka bir ürünle birleştirildi; araç uyumunu birleştiği üründe yönetin.",
  limit: `Bir ürüne en çok ${productFitmentLimit} araç kararı eklenebilir.`,
  "unknown-vehicle": "Seçilen araç tiplerinden biri katalogda bulunamadı. Listeyi yenileyip yeniden seçin.",
  duplicate: "Seçilen araçlardan biri bu ürüne zaten elle eklenmiş.",
  removed: "Seçilen araçlardan biri mağazadan çıkarılmış otomatik bir uyum; eklemek yerine listede “Yeniden göster”i kullanın.",
  "not-automatic": "Bu araç otomatik kaynakta yok; elle eklenmişse “Kaldır”ı kullanın.",
  unchanged: "Bu araç zaten mağazadan çıkarılmış.",
  stale: "Araç uyumu başka bir sekmede değişti. Sayfayı yenileyip yeniden deneyin.",
};

const productId = z.uuid();
const vehicleTypeId = z.number().int().positive().max(2147483647);

async function run(action: () => Promise<store.ProductFitmentResult>, success: string): Promise<ProductFitmentActionResult> {
  let result: store.ProductFitmentResult;
  try { result = await action(); } catch (error) {
    console.error("Product fitment change failed", error);
    return { status: "error", message: "Araç uyumu kaydedilemedi. Yeniden deneyin." };
  }
  if (!result.ok) return { status: "error", message: failures[result.reason] };
  // The make pages read storefront_make_fits, which the queued refresh rebuilds; done here so the change shows at once.
  // Best effort: the background sync drains the queue within seconds when another container holds the lock.
  try { await syncEnrichmentLinks(); } catch (error) { console.error("Storefront make list refresh after a fitment change failed", error); }
  // The vehicle filter, the fit count and vehicle searches are cached per process: they reload (#585).
  await invalidateListings();
  // The product page, its garage note and the listings show the fitments.
  revalidatePath("/", "layout");
  return { status: "success", message: success };
}

export async function addProductFitments(input: { productId: string; vehicleTypeIds: number[] }): Promise<ProductFitmentActionResult> {
  const admin = await requireAdmin();
  const data = z.object({ productId, vehicleTypeIds: z.array(vehicleTypeId).min(1).max(productFitmentBatch) }).safeParse(input);
  if (!data.success) return { status: "error", message: `1–${productFitmentBatch} araç tipi seçin.` };
  const count = new Set(data.data.vehicleTypeIds).size;
  return run(() => store.addProductFitments(db, data.data.productId, data.data.vehicleTypeIds, admin.id),
    `${count} araç tipi eklendi; ürün sayfasında, araç süzgecinde ve marka sayfasında görünür.`);
}

export async function removeProductFitment(input: { productId: string; vehicleTypeId: number }): Promise<ProductFitmentActionResult> {
  const admin = await requireAdmin();
  const data = z.object({ productId, vehicleTypeId }).safeParse(input);
  if (!data.success) return { status: "error", message: "Araç tanınmadı. Sayfayı yenileyin." };
  return run(() => store.removeProductFitment(db, data.data.productId, data.data.vehicleTypeId, admin.id),
    "Otomatik araç uyumu mağazadan çıkarıldı.");
}

export async function deleteProductFitment(input: { productId: string; rowId: string; restored?: boolean }): Promise<ProductFitmentActionResult> {
  const admin = await requireAdmin();
  const data = z.object({ productId, rowId: z.uuid(), restored: z.boolean().optional() }).safeParse(input);
  if (!data.success) return { status: "error", message: "Araç tanınmadı. Sayfayı yenileyin." };
  return run(() => store.deleteProductFitment(db, data.data.productId, data.data.rowId, admin.id),
    data.data.restored ? "Otomatik araç uyumu yeniden gösteriliyor." : "Elle eklenen araç kaldırıldı; otomatik kaynak bağlıyorsa listede kalır.");
}
