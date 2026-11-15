import { siteUrl } from "@/lib/site";
import { llmsTxt } from "@/modules/seo/llms";

export const dynamic = "force-static";

export function GET() {
  return new Response(llmsTxt(siteUrl), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=86400" },
  });
}
