import { GetObjectCommand } from "@aws-sdk/client-s3";
import { objectStorage } from "@/lib/object-storage";
import { feedEnabled, feedFileKey } from "@/modules/seo/merchant-feed";

// The product feed (#643, docs/merchant-feed.md): the gzipped file scripts/merchant-feed.ts last uploaded to S3_BUCKET,
// streamed as it is. No database read; only the listed file names are served. The file is gzip itself, so no
// Content-Encoding: merchant fetchers download it as a .gz file. The proxy leaves /feeds/ alone (no session cookie, #642).
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const key = feedFileKey(file);
  const bucket = process.env.S3_BUCKET;
  if (!key || !feedEnabled() || !bucket) return new Response(null, { status: 404 });
  try {
    const result = await objectStorage().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!result.Body) return new Response(null, { status: 404 });
    return new Response(result.Body.transformToWebStream(), { headers: {
      "Content-Type": "application/gzip",
      ...result.ContentLength !== undefined ? { "Content-Length": String(result.ContentLength) } : {},
      ...result.ETag ? { "ETag": result.ETag } : {},
      ...result.LastModified ? { "Last-Modified": result.LastModified.toUTCString() } : {},
      "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if (error instanceof Error && error.name === "NoSuchKey") return new Response(null, { status: 404 });
    console.error("Product feed could not be read", error instanceof Error ? error.name : "unknown");
    return new Response(null, { status: 503, headers: { "Retry-After": "300" } });
  }
}
