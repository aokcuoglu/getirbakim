import { GetObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { db } from "@/lib/db";
import { objectStorage } from "@/lib/object-storage";
import { blockedProductMedia } from "@/modules/admin/shared-image-blocks";
import { unlistedAutomaticMedia } from "@/modules/admin/product-media-preview";
import { adminApiAccount } from "@/modules/auth/session";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";

// Admin-only preview of a blocked shared image (#1176) or the automatic image of a non-present storefront row (#1442):
// the public /api/product-media route does not serve either.
// Never cached anywhere but per request; a 403 instead of a login redirect, since an <img> requests it.
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await adminApiAccount()) return new Response(null, { status: 403, headers });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404, headers });
  const media = await blockedProductMedia(db, id) ?? await unlistedAutomaticMedia(db, id, storefrontCompanies());
  if (!media) return new Response(null, { status: 404, headers });
  try {
    const result = await objectStorage().send(new GetObjectCommand({ Bucket: media.bucket, Key: media.object_key }));
    if (!result.Body) return new Response(null, { status: 404, headers });
    return new Response(result.Body.transformToWebStream(), { headers: {
      ...headers, "Content-Type": media.content_type, "Content-Length": String(media.size_bytes),
    } });
  } catch (error) {
    console.error("Admin media preview could not be read", error instanceof Error ? error.name : "unknown");
    return new Response(null, { status: 503, headers: { ...headers, "Retry-After": "30" } });
  }
}
