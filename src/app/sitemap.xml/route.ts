import { siteUrl } from "@/lib/site";
import { absoluteUrl } from "@/modules/seo/paths";
import { renderSitemapIndex, sitemapEnabled, sitemapFiles, xmlHeaders } from "@/modules/seo/sitemap";

// The sitemap index (#634): a fixed list of files, so no database read here. Rendered per request because the
// Docker build has no environment (SITE_URL, APP_ENV).
export const dynamic = "force-dynamic";

export function GET() {
  const files = sitemapEnabled() ? sitemapFiles().map(file => absoluteUrl(siteUrl, `/sitemaps/${file}`)) : [];
  return new Response(renderSitemapIndex(files), { headers: xmlHeaders });
}
