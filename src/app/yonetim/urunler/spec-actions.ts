"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import * as store from "@/modules/admin/product-spec-store";
import { productSpecLimit } from "@/modules/admin/product-spec-fields";

/** Result of a specification change (#603); the manager shows the message and refreshes the page. */
export type ProductSpecActionResult = { status: "success" | "error"; message: string };

const failures: Record<Exclude<store.ProductSpecResult, { ok: true }>["reason"], string> = {
  "not-found": "Ürün bulunamadı.",
  merged: "Bu ürün başka bir ürünle birleştirildi; teknik özelliklerini birleştiği üründe yönetin.",
  limit: `Bir ürüne en çok ${productSpecLimit} özellik kaydı eklenebilir.`,
  reserved: "Üretici, üretici parça numarası, OEM numarası ve barkod teknik özellik olarak girilemez: markayı ve parça numarasını “Mağaza bilgileri”nde, barkodu “Referans numaraları”nda düzenleyin. Otomatik değeri “Gizle” ile kaldırabilirsiniz.",
  "not-automatic": "Bu özellik otomatik kaynakta yok; gizlemek yerine elle girilen değeri kaldırın.",
  unchanged: "Özellik zaten bu değerle kayıtlı.",
  stale: "Teknik özellikler başka bir sekmede değişti. Sayfayı yenileyip yeniden deneyin.",
};

const productId = z.uuid();
const noControl = /^[^\u0000-\u001f\u007f]*$/;
const key = z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f\u007f|]*$/);
const spec = z.object({ productId, key, value: z.string().trim().min(1).max(500).regex(noControl) });

// The store's product page, cards, compare and catalog filters show the specifications, and so does this admin page.
const revalidateStore = () => revalidatePath("/", "layout");

async function run(action: () => Promise<store.ProductSpecResult>, success: string): Promise<ProductSpecActionResult> {
  let result: store.ProductSpecResult;
  try { result = await action(); } catch (error) {
    console.error("Product specification change failed", error);
    return { status: "error", message: "Teknik özellik kaydedilemedi. Yeniden deneyin." };
  }
  if (!result.ok) return { status: "error", message: failures[result.reason] };
  revalidateStore();
  return { status: "success", message: success };
}

/** Why an entered specification was refused before it reached the store. */
function inputError(issues: { path: PropertyKey[] }[]) {
  const path = issues[0]?.path[0];
  if (path === "key") return "Özellik adı 1–200 karakter olmalı; “|” işareti kullanılamaz.";
  if (path === "value") return "Değer 1–500 karakter olmalı.";
  return "Özellik tanınmadı. Sayfayı yenileyin.";
}

const visibility = "ürün sayfasında ve kartlarda hemen, katalog süzgeçlerinde birkaç dakika içinde";

export async function setProductSpec(input: { productId: string; key: string; value: string }): Promise<ProductSpecActionResult> {
  const admin = await requireAdmin();
  const data = spec.safeParse(input);
  if (!data.success) return { status: "error", message: inputError(data.error.issues) };
  const { productId: id, ...value } = data.data;
  return run(() => store.setProductSpec(db, id, value, admin.id), `Özellik kaydedildi; ${visibility} görünür.`);
}

export async function hideProductSpec(input: { productId: string; key: string }): Promise<ProductSpecActionResult> {
  const admin = await requireAdmin();
  const data = z.object({ productId, key }).safeParse(input);
  if (!data.success) return { status: "error", message: "Özellik tanınmadı. Sayfayı yenileyin." };
  return run(() => store.hideProductSpec(db, data.data.productId, data.data.key, admin.id), `Otomatik özellik gizlendi; ${visibility} kalkar.`);
}

export async function removeProductSpec(input: { productId: string; specId: string; shown?: boolean }): Promise<ProductSpecActionResult> {
  const admin = await requireAdmin();
  const data = z.object({ productId, specId: z.uuid(), shown: z.boolean().optional() }).safeParse(input);
  if (!data.success) return { status: "error", message: "Özellik tanınmadı. Sayfayı yenileyin." };
  return run(() => store.removeProductSpec(db, data.data.productId, data.data.specId, admin.id),
    data.data.shown ? `Otomatik özellik yeniden gösteriliyor; ${visibility} döner.` : `Elle girilen değer kaldırıldı; otomatik değer varsa ${visibility} döner.`);
}
