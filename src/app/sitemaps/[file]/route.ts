import { siteUrl } from "@/lib/site";
import { absoluteUrl, categoryPath, makePath, manufacturerPath } from "@/modules/seo/paths";
import { parseSitemapFile, renderUrlset, sitemapEnabled, staticPaths, xmlHeaders, type SitemapEntry, type SitemapFile } from "@/modules/seo/sitemap";
import { cachedCategorySlugs, cachedMakeCategoryPaths, cachedMakeSlugs, cachedManufacturerSlugs, cachedModelCategoryPaths, cachedModelPaths, cachedProductChunk } from "@/modules/seo/sitemap-cache";

// One file of the sitemap index (#634): store pages, categories, vehicle makes, manufacturers (#660), vehicle models and
// their categories (#673) or a 1/64 share of the products.
export const dynamic = "force-dynamic";

async function entries(file: SitemapFile): Promise<SitemapEntry[]> {
  switch (file.kind) {
    case "pages": return staticPaths.map(page => ({ url: absoluteUrl(siteUrl, page.path), lastModified: page.lastModified }));
    case "categories": return (await cachedCategorySlugs()).map(slug => ({ url: absoluteUrl(siteUrl, categoryPath(slug)) }));
    case "makes": return (await cachedMakeSlugs()).map(slug => ({ url: absoluteUrl(siteUrl, makePath(slug)) }));
    case "manufacturers": return (await cachedManufacturerSlugs()).map(slug => ({ url: absoluteUrl(siteUrl, manufacturerPath(slug)) }));
    case "models": return (await cachedModelPaths()).map(path => ({ url: absoluteUrl(siteUrl, path) }));
    case "modelCategories": return (await cachedModelCategoryPaths()).map(path => ({ url: absoluteUrl(siteUrl, path) }));
    case "makeCategories": return (await cachedMakeCategoryPaths()).map(path => ({ url: absoluteUrl(siteUrl, path) }));
    case "products": return (await cachedProductChunk(file.index)).map(row => ({ url: absoluteUrl(siteUrl, row.path), lastModified: row.lastmod }));
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const file = parseSitemapFile((await params).file);
  if (!file) return new Response("Bulunamadı", { status: 404 });
  return new Response(renderUrlset(sitemapEnabled() ? await entries(file) : []), { headers: xmlHeaders });
}
