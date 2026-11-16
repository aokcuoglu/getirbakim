import {db} from "@/lib/db";

/** An admin's brand logo (#819), always WebP; a hidden mark (no bytes) is not found. */
export async function GET(request: Request, {params}: {params: Promise<{id:string}>}) {
  const {id} = await params;
  if (!/^\d{1,18}$/.test(id)) return new Response(null,{status:404});
  const row = (await db.query<{image_data:Buffer;sha256:string}>(
    "SELECT image_data,sha256 FROM brand_logos WHERE brand_id=$1 AND image_data IS NOT NULL",[id])).rows[0];
  if (!row) return new Response(null,{status:404});
  const version = new URL(request.url).searchParams.get("v");
  if (version && version !== row.sha256) return new Response(null,{status:404});
  const headers = {"Content-Type":"image/webp","Cache-Control":version ? "public, max-age=31536000, immutable" : "public, max-age=3600",
    "ETag":`"${row.sha256}"`,"X-Content-Type-Options":"nosniff"};
  if (request.headers.get("if-none-match") === headers.ETag) return new Response(null,{status:304,headers});
  return new Response(new Uint8Array(row.image_data),{headers:{...headers,"Content-Length":String(row.image_data.length)}});
}
