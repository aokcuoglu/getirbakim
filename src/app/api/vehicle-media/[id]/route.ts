import { GetObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { db } from "@/lib/db";
import { objectStorage } from "@/lib/object-storage";

// Model series photographs (vehicle_model_images). The bytes are free-licensed Commons files, so pending rows are
// served too: the admin review page shows them before the store does. ?v= pins a content version for long caching.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 });
  const media = (await db.query<{ bucket: string; object_key: string; content_type: string; sha256: string; size_bytes: number }>(
    `SELECT m.bucket, m.object_key, m.content_type, m.sha256, m.size_bytes FROM product_media_objects m
     WHERE m.id=$1 AND EXISTS (SELECT 1 FROM vehicle_model_images i WHERE i.media_id=m.id)`, [id])).rows[0];
  if (!media) return new Response(null, { status: 404 });
  const version = new URL(request.url).searchParams.get("v");
  if (version && !media.sha256.startsWith(version)) return new Response(null, { status: 404 });
  const headers = { "Content-Type": media.content_type, "Content-Length": String(media.size_bytes), "ETag": `"${media.sha256}"`,
    "Cache-Control": version ? "public, max-age=31536000, immutable" : "public, max-age=86400", "X-Content-Type-Options": "nosniff" };
  if (request.headers.get("if-none-match") === headers.ETag) return new Response(null, { status: 304, headers });
  try {
    const result = await objectStorage().send(new GetObjectCommand({ Bucket: media.bucket, Key: media.object_key }));
    if (!result.Body) return new Response(null, { status: 404 });
    return new Response(result.Body.transformToWebStream(), { headers });
  } catch (error) {
    console.error("Vehicle media could not be read", error instanceof Error ? error.name : "unknown");
    return new Response(null, { status: 503, headers: { "Retry-After": "30" } });
  }
}
