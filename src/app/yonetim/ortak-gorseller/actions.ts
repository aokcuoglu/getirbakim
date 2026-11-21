"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { blockSharedImage, unblockSharedImage, type ImageBlockResult } from "@/modules/admin/shared-image-blocks";
import { syncEnrichmentLinks } from "@/modules/store/enrichment-links.server";
import { invalidateListings } from "@/modules/store/listing-epoch";

/** Result of a block change (#1136); the dialog shows an error in place and closes on success. */
export type SharedImageBlockState = { status: "idle" | "success" | "error"; message?: string };

const input = z.object({
  imageId: z.uuid(),
  blocked: z.enum(["1", "0"]),
  note: z.string().trim().max(200).optional(),
});

const failures: Record<Exclude<ImageBlockResult, { ok: true }>["reason"], string> = {
  "not-found": "Görsel artık hiçbir zenginleştirme kaydında kullanılmıyor. Sayfayı yenileyin.",
  listed: "Bu görsel yer tutucu listesinde; mağazada zaten gizleniyor.",
};

/**
 * Blocks (blocked=1) or unblocks a shared automatic image. The links of its donors are recomputed right away (a
 * queued product takes milliseconds; ~0.6 s for the most shared image locally); when another task holds the sync, its
 * 5-second tick applies the change instead.
 */
export async function setSharedImageBlock(_previous: SharedImageBlockState, form: FormData): Promise<SharedImageBlockState> {
  const admin = await requireAdmin();
  const parsed = input.safeParse({ imageId: form.get("imageId"), blocked: form.get("blocked"), note: form.get("note") ?? undefined });
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some(issue => issue.path[0] === "note");
    return { status: "error", message: tooLong ? "Not en çok 200 karakter olabilir." : "Görsel tanınmadı. Sayfayı yenileyin." };
  }
  const { imageId, blocked, note } = parsed.data;
  let result: ImageBlockResult;
  try {
    result = blocked === "1" ? await blockSharedImage(db, imageId, note ?? "", admin.id) : await unblockSharedImage(db, imageId);
  } catch (error) {
    console.error("Shared image block change failed", error);
    return { status: "error", message: "Değişiklik kaydedilemedi. Yeniden deneyin." };
  }
  if (!result.ok) return { status: "error", message: failures[result.reason] };
  try { await syncEnrichmentLinks(); } catch (error) {
    // Saved and queued: the server's sync tick applies it within seconds.
    console.error("Enrichment link sync after an image block failed", error instanceof Error ? error.message : error);
  }
  await invalidateListings();
  // Product pages, listings, the home rails and this admin page all show the image.
  revalidatePath("/", "layout");
  return { status: "success", message: blocked === "1" ? "Görsel engellendi; mağazada gizlenir." : "Engel kaldırıldı; görsel mağazada yeniden gösterilir." };
}
