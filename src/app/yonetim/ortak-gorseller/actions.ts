"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { blockSharedImage, linkQueueDrainable, unblockSharedImage, type ImageBlockResult } from "@/modules/admin/shared-image-blocks";
import { syncEnrichmentLinks } from "@/modules/store/enrichment-links.server";
import { invalidateListings } from "@/modules/store/listing-epoch";

/** Result of a block change (#1136): the dialog shows an error in place and closes on success. */
export type SharedImageBlockState = { status: "idle" | "success" } | { status: "error"; message: string };

const input = z.object({
  imageId: z.uuid(),
  blocked: z.enum(["1", "0"]),
  note: z.string().trim().max(200).optional(),
});

const failures: Record<Exclude<ImageBlockResult, { ok: true }>["reason"], string> = {
  "not-found": "Görsel artık hiçbir zenginleştirme kaydında kullanılmıyor. Sayfayı yenileyin.",
  listed: "Bu görsel yer tutucu listesinde; mağazada zaten gizleniyor.",
};

/** Blocks (blocked=1) or unblocks a shared automatic image, then brings the store's links and caches up to date. */
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
  // The donors are queued. A small queue is drained here (~0.6 s for the most shared image locally), so the pages
  // revalidated below already read the new links. A queue holding the full-rebuild marker or a large backlog is left to
  // the server's sync tick (startEnrichmentLinkSync, every 5 s), as fitment-actions.ts does: a rebuild takes 10-20 s.
  // When the tick or another task holds the sync lock, syncEnrichmentLinks() returns at once and the tick applies the
  // block seconds later; a listing or page cached in between keeps the old image until the next epoch bump,
  // revalidation or its TTL. That window is accepted (a second bump would land before the tick, so it would not help).
  try { if (await linkQueueDrainable(db)) await syncEnrichmentLinks(); } catch (error) {
    // Saved and queued: the tick applies it.
    console.error("Enrichment link sync after an image block failed", error instanceof Error ? error.message : error);
  }
  await invalidateListings();
  // Product pages, listings, the home rails and this admin page all show the image.
  revalidatePath("/", "layout");
  return { status: "success" };
}
