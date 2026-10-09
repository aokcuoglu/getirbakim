import { GetObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { db } from "@/lib/db";
import { objectStorage } from "@/lib/object-storage";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 });
  const media = (await db.query<{ bucket: string; object_key: string; content_type: string; sha256: string; size_bytes: number }>(
    `SELECT m.* FROM product_media_objects m WHERE m.id=$1 AND EXISTS
     (SELECT 1 FROM source_category_images c WHERE c.media_id=m.id)`, [id])).rows[0];
  if (!media) return new Response(null, { status: 404 });
  try {
    const result = await objectStorage().send(new GetObjectCommand({ Bucket: media.bucket, Key: media.object_key }));
    if (!result.Body) return new Response(null, { status: 404 });
    return new Response(result.Body.transformToWebStream(), { headers: {
      "Content-Type": media.content_type, "Content-Length": String(media.size_bytes),
      "Cache-Control": "public, max-age=86400", "ETag": `"${media.sha256}"`, "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    console.error("Category media could not be read", error instanceof Error ? error.name : "unknown");
    return new Response(null, { status: 503, headers: { "Retry-After": "30" } });
  }
}
