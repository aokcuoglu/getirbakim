"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { brandLogoLimits, brandLogoTypes } from "@/modules/admin/brand-logo-limits";
import * as store from "@/modules/admin/brand-logo-store";
import type { BrandLogoErrorReason } from "@/modules/admin/brand-logo-upload";
import { fetchRemoteImage } from "@/modules/admin/remote-image";
import { remoteImageMessages } from "@/modules/admin/remote-image-messages";
import { parseRemoteImageUrl, RemoteImageError, remoteImageUrlMaxLength } from "@/modules/admin/remote-image-url";

/** Result of a brand logo change (#819); the logo field shows the message and refreshes the page. */
export type BrandLogoActionResult = { status: "success" | "error"; message: string };

const logoFailures: Record<BrandLogoErrorReason, string> = {
  type: "Yalnız PNG, SVG, WebP veya JPEG logo yüklenebilir.",
  size: `Logo en çok ${brandLogoLimits.maxBytes / 1024 / 1024} MB olabilir.`,
  dimensions: `Logonun iki kenarı da en az ${brandLogoLimits.minSide} piksel olmalı (en çok 25 megapiksel).`,
  unreadable: "Logo okunamadı; dosya bozuk olabilir.",
};
const remoteFailures = remoteImageMessages({ typesText: "PNG, SVG, WebP veya JPEG", sizeText: logoFailures.size });
const notFound: BrandLogoActionResult = { status: "error", message: "Ana marka bulunamadı. Sayfayı yenileyin." };

const brandId = z.string().regex(/^\d{1,18}$/);
const remoteUrl = z.string().trim().max(remoteImageUrlMaxLength).refine(value => parseRemoteImageUrl(value) !== null);

// Every store page that shows the brand's products, and this list.
function revalidate() {
  revalidatePath("/", "layout");
  revalidatePath("/yonetim/urun-eslestirme");
}

async function run(action: () => Promise<store.BrandLogoResult>, success: string): Promise<BrandLogoActionResult> {
  let result: store.BrandLogoResult;
  try { result = await action(); } catch (error) {
    console.error("Brand logo change failed", error);
    return { status: "error", message: "Logo kaydedilemedi. Yeniden deneyin." };
  }
  if (!result.ok) return result.reason === "image" && result.image ? { status: "error", message: logoFailures[result.image] } : notFound;
  revalidate();
  return { status: "success", message: success };
}

export async function uploadBrandLogo(form: FormData): Promise<BrandLogoActionResult> {
  const admin = await requireAdmin();
  const id = brandId.safeParse(form.get("brand_id"));
  const file = form.get("file");
  if (!id.success || !(file instanceof File)) return { status: "error", message: "Yükleme tanınmadı. Sayfayı yenileyin." };
  if (!file.size || file.size > brandLogoLimits.maxBytes) return { status: "error", message: logoFailures.size };
  // The declared type only turns away an obviously wrong file; the bytes decide (prepareBrandLogo).
  if (!brandLogoTypes.some(type => type === file.type)) return { status: "error", message: logoFailures.type };
  const bytes = Buffer.from(await file.arrayBuffer());
  return run(() => store.setBrandLogo(db, id.data, { bytes, name: file.name }, admin.id), "Logo kaydedildi.");
}

/** Downloads the logo through the SSRF-safe fetch, then stores it like an uploaded file. */
export async function setBrandLogoFromUrl(input: { brandId: string; url: string }): Promise<BrandLogoActionResult> {
  const admin = await requireAdmin();
  const id = brandId.safeParse(input?.brandId);
  if (!id.success) return notFound;
  const url = remoteUrl.safeParse(input?.url);
  if (!url.success) return { status: "error", message: remoteFailures.url };
  let image: Awaited<ReturnType<typeof fetchRemoteImage>>;
  try { image = await fetchRemoteImage(url.data, { maxBytes: brandLogoLimits.maxBytes, types: brandLogoTypes }); } catch (error) {
    if (error instanceof RemoteImageError) return { status: "error", message: remoteFailures[error.reason] };
    console.error("Brand logo download failed", error);
    return { status: "error", message: remoteFailures.unreachable };
  }
  return run(() => store.setBrandLogo(db, id.data, { ...image, sourceUrl: url.data }, admin.id), "Logo adresten alındı.");
}

/** No logo for the brand in the store, not even an automatic one. */
export async function removeBrandLogo(input: { brandId: string }): Promise<BrandLogoActionResult> {
  const admin = await requireAdmin();
  const id = brandId.safeParse(input?.brandId);
  if (!id.success) return notFound;
  return run(() => store.hideBrandLogo(db, id.data, admin.id), "Logo kaldırıldı; mağazada bu marka logosuz görünür.");
}

/** Drops the admin's logo or hidden mark; the automatic logo (if any) shows again. */
export async function resetBrandLogo(input: { brandId: string }): Promise<BrandLogoActionResult> {
  await requireAdmin();
  const id = brandId.safeParse(input?.brandId);
  if (!id.success) return notFound;
  return run(() => store.resetBrandLogo(db, id.data), "Otomatik logoya dönüldü.");
}
