import {db} from "@/lib/db";
import {logoCacheControl} from "@/modules/store/manufacturer-logo-cache";

export async function GET(request: Request, {params}: {params: Promise<{key:string}>}) {
  const {key} = await params;
  if (!/^[A-Z0-9]{1,100}$/.test(key)) return new Response(null,{status:404});
  const row = (await db.query<{image_data:Buffer;sha256:string}>("SELECT image_data,sha256 FROM manufacturer_logos WHERE brand_key=$1",[key])).rows[0];
  if (!row) return new Response(null,{status:404});
  const version = new URL(request.url).searchParams.get("v");
  const headers = {"Content-Type":"image/png","Cache-Control":logoCacheControl(version,row.sha256),
    "ETag":`"${row.sha256}"`,"X-Content-Type-Options":"nosniff"};
  if (request.headers.get("if-none-match") === headers.ETag) return new Response(null,{status:304,headers});
  return new Response(new Uint8Array(row.image_data),{headers:{...headers,"Content-Length":String(row.image_data.length)}});
}
