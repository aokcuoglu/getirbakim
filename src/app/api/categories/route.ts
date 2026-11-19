import { compressedJson } from "@/lib/compressed-json";
import { getStoreCategories } from "@/modules/store/categories";
import { packCategoryTree } from "@/modules/store/category-tree";

// The full category tree for the header menu and the sidebar search, loaded on first use instead of riding in
// every page's HTML (#642). Route Handlers are not cached by Next.js; browsers and the CDN may keep it a while.
export async function GET(request: Request) {
  try {
    return compressedJson(request, packCategoryTree(await getStoreCategories()), {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    console.error("Category tree could not be loaded", error);
    return Response.json({ error: "Kategoriler yüklenemedi." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
