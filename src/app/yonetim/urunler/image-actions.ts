"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { invalidateListings } from "@/modules/store/listing-epoch";
import * as store from "@/modules/admin/product-image-store";
import { productImageLimits, productImageTypes, type ProductImageErrorReason } from "@/modules/admin/product-image-upload";
import { fetchRemoteImage } from "@/modules/admin/remote-image";
import { parseRemoteImageUrl, RemoteImageError, remoteImageUrlMaxLength, type RemoteImageErrorReason } from "@/modules/admin/remote-image-url";

/** Result of a gallery change (#581); the manager shows the message and refreshes the page. */
export type ProductImageActionResult = { status: "success" | "error"; message: string };

const failures: Record<Exclude<store.ProductImageResult, { ok: true }>["reason"], string> = {
  "not-found": "Ürün bulunamadı.",
  merged: "Bu ürün başka bir ürünle birleştirildi; görselleri birleştiği üründe yönetin.",
  limit: `Bir ürüne en çok ${productImageLimits.maxImages} görsel eklenebilir.`,
  duplicate: "Bu görsel üründe zaten var.",
  stale: "Görseller başka bir sekmede değişti. Sayfayı yenileyip yeniden deneyin.",
  image: "Görsel okunamadı.",
};
const imageFailures: Record<ProductImageErrorReason, string> = {
  type: "Yalnız tek kareli JPEG, PNG veya WebP görseller yüklenebilir.",
  size: `Görsel en çok ${productImageLimits.maxBytes / 1024 / 1024} MB olabilir.`,
  dimensions: `Görselin iki kenarı da en az ${productImageLimits.minSide} piksel olmalı (en çok 25 megapiksel).`,
  unreadable: "Görsel okunamadı; dosya bozuk olabilir.",
};

const remoteFailures: Record<RemoteImageErrorReason, string> = {
  url: `Geçerli bir http:// veya https:// görsel adresi girin (kullanıcı adı/parola olmadan, en çok ${remoteImageUrlMaxLength} karakter).`,
  port: "Bu bağlantı noktasına izin verilmiyor: yalnız 80, 443, 8080 ve 8443 portlarındaki adresler eklenebilir.",
  blocked: "Bu adrese erişilemez: yalnız internetteki herkese açık adreslerden görsel alınabilir.",
  unreachable: "Adrese ulaşılamadı. Adresi kontrol edip yeniden deneyin.",
  timeout: "Adres zamanında yanıt vermedi. Yeniden deneyin.",
  status: "Adres görseli döndürmedi (sayfa bulunamadı veya erişim reddedildi).",
  "not-image": "Adres bir görsel değil: yalnız JPEG, PNG veya WebP görsel adresleri eklenebilir.",
  size: imageFailures.size,
  redirects: "Adres çok fazla yönlendirme yaptı; görselin doğrudan adresini girin.",
};

const productId = z.uuid();
const remoteUrl = z.string().trim().max(remoteImageUrlMaxLength).refine(value => parseRemoteImageUrl(value) !== null);
const imageId = z.uuid();
const order = z.array(z.uuid()).min(1).max(productImageLimits.maxImages);

// The store's product page, listings, cart and this admin page all show the product's images.
const revalidateStore = () => revalidatePath("/", "layout");

/**
 * `listings`: the change can add a product to or drop it from the home rails (they count only products whose image the
 * store shows, #596), so the cached listing picks reload.
 */
async function run(action: () => Promise<store.ProductImageResult>, success: string,
  { revalidate = true, listings = false }: { revalidate?: boolean; listings?: boolean } = {}): Promise<ProductImageActionResult> {
  let result: store.ProductImageResult;
  try { result = await action(); } catch (error) {
    console.error("Product image change failed", error);
    return { status: "error", message: "Görseller kaydedilemedi. Yeniden deneyin." };
  }
  if (!result.ok) return { status: "error", message: result.reason === "image" && result.image ? imageFailures[result.image] : failures[result.reason] };
  if (revalidate) revalidateStore();
  if (listings) await invalidateListings();
  return { status: "success", message: success };
}

/**
 * One file per call: the manager sends the selected files one after another, then calls finishProductImageUpload once
 * to refresh the cached pages (not once per file).
 */
export async function uploadProductImage(form: FormData): Promise<ProductImageActionResult> {
  const admin = await requireAdmin();
  const id = productId.safeParse(form.get("product_id"));
  const file = form.get("file");
  if (!id.success || !(file instanceof File)) return { status: "error", message: "Yükleme tanınmadı. Sayfayı yenileyin." };
  if (!file.size || file.size > productImageLimits.maxBytes) return { status: "error", message: imageFailures.size };
  if (!productImageTypes.some(type => type === file.type)) return { status: "error", message: imageFailures.type };
  const bytes = Buffer.from(await file.arrayBuffer());
  return run(() => store.addProductImage(db, id.data, { bytes, name: file.name }, admin.id), "Görsel eklendi.", { revalidate: false });
}

/**
 * Adds an image from a URL an admin pasted (#725): the server downloads it through the SSRF-safe fetch, then it goes
 * through the same checks and store as an uploaded file. The manager calls finishProductImageUpload after a success.
 */
export async function addProductImageFromUrl(input: { productId: string; url: string }): Promise<ProductImageActionResult> {
  const admin = await requireAdmin();
  const id = productId.safeParse(input?.productId);
  if (!id.success) return { status: "error", message: "Yükleme tanınmadı. Sayfayı yenileyin." };
  const url = remoteUrl.safeParse(input?.url);
  if (!url.success) return { status: "error", message: remoteFailures.url };
  let image: Awaited<ReturnType<typeof fetchRemoteImage>>;
  try { image = await fetchRemoteImage(url.data); } catch (error) {
    if (error instanceof RemoteImageError) return { status: "error", message: remoteFailures[error.reason] };
    console.error("Product image download failed", error);
    return { status: "error", message: remoteFailures.unreachable };
  }
  return run(() => store.addProductImage(db, id.data, image, admin.id), "Görsel adresten eklendi.", { revalidate: false });
}

/** End of an upload batch: the store's cached pages and listing picks are refreshed once. */
export async function finishProductImageUpload(id: string): Promise<void> {
  await requireAdmin();
  if (!productId.safeParse(id).success) return;
  revalidateStore();
  await invalidateListings();
}

export async function removeProductImage(input: { productId: string; imageId: string }): Promise<ProductImageActionResult> {
  const admin = await requireAdmin();
  const data = z.object({ productId, imageId }).safeParse(input);
  if (!data.success) return { status: "error", message: "Görsel tanınmadı. Sayfayı yenileyin." };
  return run(() => store.removeProductImage(db, data.data.productId, data.data.imageId, admin.id), "Görsel silindi.", { listings: true });
}

export async function reorderProductImages(input: { productId: string; imageIds: string[] }): Promise<ProductImageActionResult> {
  const admin = await requireAdmin();
  const data = z.object({ productId, imageIds: order }).safeParse(input);
  if (!data.success) return { status: "error", message: "Sıralama tanınmadı. Sayfayı yenileyin." };
  return run(() => store.reorderProductImages(db, data.data.productId, data.data.imageIds, admin.id), "Görsel sırası kaydedildi.");
}

export async function setAutomaticImageHidden(input: { productId: string; hidden: boolean }): Promise<ProductImageActionResult> {
  const admin = await requireAdmin();
  const data = z.object({ productId, hidden: z.boolean() }).safeParse(input);
  if (!data.success) return { status: "error", message: "Ayar tanınmadı. Sayfayı yenileyin." };
  return run(() => store.setAutomaticImageHidden(db, data.data.productId, data.data.hidden, admin.id),
    data.data.hidden ? "Otomatik görsel mağazada gizlendi." : "Otomatik görsel mağazada gösteriliyor.", { listings: true });
}
