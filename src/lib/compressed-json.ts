import { brotliCompressSync, constants, gzipSync } from "node:zlib";

// `next start` compresses pages but not Route Handler responses, and CloudFront's caching-disabled policy does not
// either (#453), so a large JSON body would go out raw. Compress it here; a response that already carries
// Content-Encoding is left alone by Next's own compressor, so nothing is encoded twice (#1008).
const MIN_COMPRESS_BYTES = 1024;

export type JsonEncoding = "br" | "gzip";

// The best encoding the request's Accept-Encoding allows (br over gzip, `q=0` refuses, `*` allows both), or null.
export function pickEncoding(acceptEncoding: string | null): JsonEncoding | null {
  if (!acceptEncoding) return null;
  const weights = new Map<string, number>();
  for (const part of acceptEncoding.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
    const weight = q ? Number(q.slice(2)) : 1;
    if (name) weights.set(name.trim(), Number.isNaN(weight) ? 0 : weight);
  }
  const allowed = (name: string) => (weights.get(name) ?? weights.get("*") ?? 0) > 0;
  if (allowed("br")) return "br";
  if (allowed("gzip")) return "gzip";
  return null;
}

export function compressedJson(request: Request, body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  const text = JSON.stringify(body);
  const headers: Record<string, string> = { ...init.headers, "Content-Type": "application/json; charset=utf-8", Vary: "Accept-Encoding" };
  const status = init.status ?? 200;
  const encoding = status < 300 && Buffer.byteLength(text) >= MIN_COMPRESS_BYTES ? pickEncoding(request.headers.get("accept-encoding")) : null;
  if (!encoding) return new Response(text, { status, headers });
  const compressed =
    encoding === "br"
      ? brotliCompressSync(text, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
      : gzipSync(text);
  return new Response(new Uint8Array(compressed), { status, headers: { ...headers, "Content-Encoding": encoding } });
}
