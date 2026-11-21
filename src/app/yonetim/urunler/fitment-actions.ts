"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { invalidateListings } from "@/modules/store/listing-epoch";
import * as store from "@/modules/admin/product-fitment-store";
import * as hides from "@/modules/admin/product-fitment-hide-store";
import * as copies from "@/modules/admin/product-fitment-copy";
import { fitmentCopyModelLimit, productFitmentBatch, productFitmentHideLimit, productFitmentLimit } from "@/modules/admin/product-fitment-fields";
import { formatNumber } from "@/modules/admin/format";

/**
 * Result of a vehicle fitment change (#583); the manager shows the message and refreshes the page. `undo`: the bulk
 * add or copy just written, which the success alert offers to take back (#817).
 */
export type ProductFitmentActionResult = { status: "success" | "error"; message: string; undo?: { batchId: string; count: number } };

const failures: Record<Exclude<store.ProductFitmentResult, { ok: true }>["reason"], string> = {
  "not-found": "Ürün bulunamadı.",
  merged: "Bu ürün başka bir ürünle birleştirildi; araç uyumunu birleştiği üründe yönetin.",
  limit: `Bir ürüne en çok ${formatNumber(productFitmentLimit)} araç kararı eklenebilir.`,
  "hide-limit": `Bir üründe en çok ${formatNumber(productFitmentHideLimit)} kaynak satırı mağazadan çıkarılabilir; yeni satır çıkarmak için önce birini yeniden gösterin.`,
  "unknown-vehicle": "Seçilen araç tiplerinden biri katalogda bulunamadı. Listeyi yenileyip yeniden seçin.",
  duplicate: "Seçilen araçlardan biri bu ürüne zaten elle eklenmiş.",
  removed: "Seçilen araçlardan biri mağazadan çıkarılmış otomatik bir uyum; eklemek yerine listede “Yeniden göster”i kullanın.",
  "not-automatic": "Bu araç otomatik kaynakta yok; elle eklenmişse “Kaldır”ı kullanın.",
  unchanged: "Bu araç veya kaynak satırı zaten mağazadan çıkarılmış.",
  stale: "Araç uyumu başka bir sekmede değişti. Sayfayı yenileyip yeniden deneyin.",
  "not-in-source": "Bu satır ürünün kaynaklarında artık yok. Sayfayı yenileyin.",
  "bad-source": "Kaynak ürün bulunamadı ya da başka bir ürünle birleştirilmiş.",
  "nothing-to-copy": "Kaynak üründe bu ürüne eklenecek yeni araç tipi yok.",
  "nothing-to-undo": "Bu toplu işlemin geri alınacak aracı kalmadı.",
};

const productId = z.uuid();
const vehicleTypeId = z.number().int().positive().max(2147483647);

type Success = Extract<store.ProductFitmentResult, { ok: true }>;

/** Runs a change; `success` is the message, or reads it from the stored result (a copy's count). */
async function run(action: () => Promise<store.ProductFitmentResult>, success: string | ((result: Success) => string)): Promise<ProductFitmentActionResult> {
  let result: store.ProductFitmentResult;
  try { result = await action(); } catch (error) {
    console.error("Product fitment change failed", error);
    return { status: "error", message: "Araç uyumu kaydedilemedi. Yeniden deneyin." };
  }
  if (!result.ok) return { status: "error", message: failures[result.reason] };
  // The make and model pages read storefront_make_fits / storefront_model_fits, and the make page also
  // storefront_make_description_fits (a hidden description model, #956): the triggers queued the product and the
  // background link sync (startEnrichmentLinkSync, every few seconds) rebuilds them and then bumps the listing epoch
  // again (at most every 30 s), since the bump below runs before that rebuild. Not drained here: a queued full rebuild would run inside
  // this request.
  // The vehicle filter, the fit count and vehicle searches are cached per process: they reload (#585).
  await invalidateListings();
  // The product page, its garage note and the listings show the fitments.
  revalidatePath("/", "layout");
  const message = typeof success === "string" ? success : success(result);
  return result.batchId ? { status: "success", message, undo: { batchId: result.batchId, count: result.added ?? 0 } } : { status: "success", message };
}

export async function addProductFitments(input: { productId: string; vehicleTypeIds: number[] }): Promise<ProductFitmentActionResult> {
  const admin = await requireAdmin();
  const data = z.object({ productId, vehicleTypeIds: z.array(vehicleTypeId).min(1).max(productFitmentBatch) }).safeParse(input);
  if (!data.success) return { status: "error", message: `1–${productFitmentBatch} araç tipi seçin.` };
  const count = new Set(data.data.vehicleTypeIds).size;
  return run(() => store.addProductFitments(db, data.data.productId, data.data.vehicleTypeIds, admin.id),
    `${formatNumber(count)} araç tipi eklendi; ürün sayfasında ve araç süzgecinde hemen, marka sayfasında birkaç saniye içinde görünür.`);
}

/**
 * Copies another product's vehicle fitments as added types (#662); `expected` is the count the preview showed for the
 * choice, `modelIds` the vehicle models chosen (#815; without it every new type).
 */
export async function copyProductFitments(input: { productId: string; sourceId: string; expected: number; modelIds?: number[] }): Promise<ProductFitmentActionResult> {
  const admin = await requireAdmin();
  const data = z.object({
    productId, sourceId: z.uuid(), expected: z.number().int().min(1).max(productFitmentLimit),
    modelIds: z.array(z.number().int().positive().max(2147483647)).min(1).max(fitmentCopyModelLimit).optional(),
  }).safeParse(input);
  if (!data.success) return { status: "error", message: "Kopyalanacak ürün tanınmadı. Önizlemeyi yeniden açın." };
  return run(() => copies.copyProductFitments(db, data.data.productId, data.data.sourceId, data.data.expected, admin.id, data.data.modelIds),
    result => `${formatNumber(result.added ?? 0)} araç tipi kopyalandı; ürün sayfasında ve araç süzgecinde hemen, marka sayfasında birkaç saniye içinde görünür.`);
}

export async function removeProductFitment(input: { productId: string; vehicleTypeId: number }): Promise<ProductFitmentActionResult> {
  const admin = await requireAdmin();
  const data = z.object({ productId, vehicleTypeId }).safeParse(input);
  if (!data.success) return { status: "error", message: "Araç tanınmadı. Sayfayı yenileyin." };
  return run(() => store.removeProductFitment(db, data.data.productId, data.data.vehicleTypeId, admin.id),
    "Otomatik araç uyumu mağazadan çıkarıldı; marka sayfası birkaç saniye içinde güncellenir.");
}

export async function deleteProductFitment(input: { productId: string; rowId: string; restored?: boolean }): Promise<ProductFitmentActionResult> {
  const admin = await requireAdmin();
  const data = z.object({ productId, rowId: z.uuid(), restored: z.boolean().optional() }).safeParse(input);
  if (!data.success) return { status: "error", message: "Araç tanınmadı. Sayfayı yenileyin." };
  return run(() => store.deleteProductFitment(db, data.data.productId, data.data.rowId, admin.id),
    data.data.restored ? "Otomatik araç uyumu yeniden gösteriliyor; marka sayfası birkaç saniye içinde güncellenir." : "Elle eklenen araç kaldırıldı; otomatik kaynak bağlıyorsa listede kalır. Marka sayfası birkaç saniye içinde güncellenir.");
}

/** Takes a bulk add or copy back in one step (#817): the batch's types still added leave the product. */
export async function undoProductFitmentBatch(input: { productId: string; batchId: string }): Promise<ProductFitmentActionResult> {
  const admin = await requireAdmin();
  const data = z.object({ productId, batchId: z.uuid() }).safeParse(input);
  if (!data.success) return { status: "error", message: "Toplu işlem tanınmadı. Sayfayı yenileyin." };
  return run(() => store.undoFitmentBatch(db, data.data.productId, data.data.batchId, admin.id),
    result => `${formatNumber(result.undone ?? 0)} araç tipi geri alındı; marka sayfası birkaç saniye içinde güncellenir.`);
}

const hideTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["source_vehicle", "source_model"]), key: z.string().min(1).max(2000) }),
  z.object({ kind: z.literal("description_model"), modelId: z.number().int().positive().max(2147483647) }),
]);

/** Leaves a source row the catalog does not link (#661) out of the store: an unlinked vehicle, a listed or described model. */
export async function hideProductFitment(input: { productId: string; target: hides.FitmentHideTarget }): Promise<ProductFitmentActionResult> {
  const admin = await requireAdmin();
  const data = z.object({ productId, target: hideTarget }).safeParse(input);
  if (!data.success) return { status: "error", message: "Satır tanınmadı. Sayfayı yenileyin." };
  return run(() => hides.hideProductFitment(db, data.data.productId, data.data.target, admin.id),
    "Satır mağazadan çıkarıldı; ürün sayfasında hemen, marka ve model sayfalarında birkaç saniye içinde kalkar.");
}

export async function showProductFitment(input: { productId: string; rowId: string }): Promise<ProductFitmentActionResult> {
  const admin = await requireAdmin();
  const data = z.object({ productId, rowId: z.uuid() }).safeParse(input);
  if (!data.success) return { status: "error", message: "Satır tanınmadı. Sayfayı yenileyin." };
  return run(() => hides.showProductFitment(db, data.data.productId, data.data.rowId, admin.id),
    "Satır yeniden gösteriliyor; marka ve model sayfaları birkaç saniye içinde güncellenir.");
}
