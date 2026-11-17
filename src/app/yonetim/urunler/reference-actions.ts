"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { invalidateListings } from "@/modules/store/listing-epoch";
import { syncEnrichmentLinks } from "@/modules/store/enrichment-links.server";
import { persistProductOverride } from "@/modules/admin/product-override-store";
import * as store from "@/modules/admin/product-reference-store";
import { productReferenceLimit, referenceKinds } from "@/modules/admin/product-reference-fields";

/** Result of a reference change (#582); the manager shows the message and refreshes the page. */
export type ProductReferenceActionResult = { status: "success" | "error"; message: string };

const failures: Record<Exclude<store.ProductReferenceResult, { ok: true }>["reason"], string> = {
  "not-found": "Ürün bulunamadı.",
  merged: "Bu ürün başka bir ürünle birleştirildi; referanslarını birleştiği üründe yönetin.",
  limit: `Bir ürüne en çok ${productReferenceLimit} referans kaydı eklenebilir.`,
  duplicate: "Bu numara üründe zaten kayıtlı.",
  hidden: "Bu numara otomatik referans olarak gizlenmiş; eklemek yerine “Yeniden göster”i kullanın.",
  ean: "Barkod geçerli değil: 8, 12, 13 veya 14 haneli ve kontrol hanesi doğru bir EAN/GTIN girin.",
  stale: "Referanslar başka bir sekmede değişti. Sayfayı yenileyip yeniden deneyin.",
};

const compact = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const productId = z.uuid();
const noControl = /^[^\u0000-\u001f\u007f]*$/;
const brand = z.string().trim().max(80).regex(noControl);
// Typed by the admin: the spelling a catalogue prints.
const reference = z.object({
  productId,
  kind: z.enum(referenceKinds),
  brand,
  number: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 ./-]{2,59}$/).refine(value => compact(value).length >= 3),
}).refine(value => value.kind === "ean" || compact(value.brand).length > 0, { path: ["brand"] });
// An automatic number to hide, as the enrichment spelled it ("|" separates the history text).
const automatic = z.object({
  productId,
  kind: z.enum(["oem", "cross"]),
  brand: brand.refine(value => compact(value).length > 0),
  number: z.string().trim().min(3).max(60).regex(/^[^\u0000-\u001f\u007f|]*$/).refine(value => compact(value).length >= 3),
});

// The store's product page, its search and this admin page all show the numbers.
const revalidateStore = () => revalidatePath("/", "layout");

async function run(action: () => Promise<store.ProductReferenceResult>, success: string): Promise<ProductReferenceActionResult> {
  let result: store.ProductReferenceResult;
  try { result = await action(); } catch (error) {
    console.error("Product reference change failed", error);
    return { status: "error", message: "Referans kaydedilemedi. Yeniden deneyin." };
  }
  if (!result.ok) return { status: "error", message: failures[result.reason] };
  // Code search lists products by their reference numbers: cached searches reload (#585).
  await invalidateListings();
  revalidateStore();
  return { status: "success", message: success };
}

/** Why an entered number was refused before it reached the store. */
function inputError(issues: { path: PropertyKey[] }[]) {
  const path = issues[0]?.path[0];
  if (path === "brand") return "Marka girin (en çok 80 karakter; OEM için araç markası, muadil kod için üretici).";
  if (path === "number") return "Numara 3–60 karakter olmalı; yalnız harf, rakam, boşluk, nokta, eğik çizgi ve tire kullanılabilir.";
  return "Referans tanınmadı. Sayfayı yenileyin.";
}

export async function addProductReference(input: { productId: string; kind: string; brand: string; number: string }): Promise<ProductReferenceActionResult> {
  const admin = await requireAdmin();
  const data = reference.safeParse(input);
  if (!data.success) return { status: "error", message: inputError(data.error.issues) };
  const { productId: id, ...value } = data.data;
  return run(() => store.addProductReference(db, id, value, admin.id), "Referans eklendi; ürün sayfasında hemen, kod aramasında birkaç saniye içinde görünür.");
}

export async function hideProductReference(input: { productId: string; kind: string; brand: string; number: string }): Promise<ProductReferenceActionResult> {
  const admin = await requireAdmin();
  const data = automatic.safeParse(input);
  if (!data.success) return { status: "error", message: "Referans tanınmadı. Sayfayı yenileyin." };
  const { productId: id, kind, brand, number } = data.data;
  return run(() => store.hideProductReference(db, id, { kind, brand, number }, admin.id), "Otomatik referans ürün sayfasında gizlendi; kod aramasından birkaç saniye içinde çıkar.");
}

export async function removeProductReference(input: { productId: string; referenceId: string; shown?: boolean }): Promise<ProductReferenceActionResult> {
  const admin = await requireAdmin();
  const data = z.object({ productId, referenceId: z.uuid(), shown: z.boolean().optional() }).safeParse(input);
  if (!data.success) return { status: "error", message: "Referans tanınmadı. Sayfayı yenileyin." };
  return run(() => store.removeProductReference(db, data.data.productId, data.data.referenceId, admin.id),
    data.data.shown ? "Otomatik referans yeniden gösteriliyor." : "Referans kaldırıldı.");
}

/**
 * Hides the supplier rows' OEM field on the store (#615), or shows it again, for every source row of the product: the
 * product page, cards, cart, partner API and storefront code search. Stored as a product edit (history, merge carry and
 * undo); supplier data keeps the number. Hiding also drops the OEM equivalents that number formed (#631,
 * product_hidden_oem_drop; manual equivalents stay); shown again, they return with the next matching refresh.
 * Enrichment matched through that OEM (vehicle fitments, specifications, image) leaves the store with it and comes back
 * when shown (#865, enrichment_valid_data); the raw enrichment rows are kept. The override triggers queue the product,
 * and the queues are drained here so the store and the enrichment dashboard follow at once; a failed drain is left to
 * the background link sync and the dashboard's own drain, so it does not fail the saved change.
 */
export async function setSupplierOemHidden(input: { productId: string; hidden: boolean }): Promise<ProductReferenceActionResult> {
  const admin = await requireAdmin();
  const data = z.object({ productId, hidden: z.boolean() }).safeParse(input);
  if (!data.success) return { status: "error", message: "Ürün tanınmadı. Sayfayı yenileyin." };
  let result: Awaited<ReturnType<typeof persistProductOverride>>;
  try {
    result = await persistProductOverride(db, data.data.productId, { hide_supplier_oem: data.data.hidden }, admin.id);
  } catch (error) {
    console.error("Supplier OEM visibility change failed", error);
    return { status: "error", message: "Değişiklik kaydedilemedi. Yeniden deneyin." };
  }
  if (!result.ok) return { status: "error", message: result.reason === "merged" ? failures.merged : failures["not-found"] };
  if (result.changed.length) {
    try { await syncEnrichmentLinks(); }
    catch (error) { console.error("Storefront enrichment link sync after a supplier OEM change failed", error); }
    try { await db.query("SELECT enrichment_product_states_sync()"); }
    catch (error) { console.error("enrichment_product_states_sync after a supplier OEM change failed", error); }
    // Code search lists products by their supplier OEM: cached searches reload (#585).
    await invalidateListings();
    revalidateStore();
  }
  return { status: "success", message: data.data.hidden
    ? "Tedarikçi OEM alanı mağazada gizlendi; kod aramasından birkaç dakika içinde çıkar (aynı numara otomatik listede ya da elle eklenmişse görünmeye ve aranmaya devam eder). Bu OEM'den doğan muadil bağlantıları kaldırıldı; elle eklenenler korunur. Yalnız bu OEM ile eşleşen kaynak verisi (araç uyumluluğu, özellikler, görsel) de mağazada kullanılmaz; birebir parça ve muadil kod eşleşmeleri etkilenmez."
    : "Tedarikçi OEM alanı yeniden gösteriliyor. Bu OEM'den doğan muadil bağlantıları bir sonraki eşleştirme yenilemesinde geri gelir; hemen geri getirmek için Ürün eşleştirme sayfasında Yenile'yi kullanın. Bu OEM ile eşleşen kaynak verisi birkaç saniye içinde geri gelir." };
}
