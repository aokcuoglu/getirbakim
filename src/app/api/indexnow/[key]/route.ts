import { indexNowConfig } from "@/modules/seo/indexnow";

// The IndexNow key file (#645): served as /<key>.txt through a rewrite in next.config.ts, so search engines can
// verify that the reported URLs belong to this host. Any other name, or no key, is a 404.
export const dynamic = "force-dynamic";

function configuredKey() {
  try { return indexNowConfig()?.key ?? null; } catch { return null; }
}

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const expected = configuredKey();
  if (!expected || key !== expected) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(expected, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
