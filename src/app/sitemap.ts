import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { db } from "@/lib/db";
import { legalLinks } from "@/content/legal";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Supplier observations are not ready for sale. Demo products must not be indexed.
  const { rows } = await db.query<{ id: string; updated_at: Date }>("SELECT id,updated_at FROM products WHERE supplier<>'demo' ORDER BY id LIMIT 49000");
  return [
    ...["", "/katalog", "/servisler", "/bilgi/hakkimizda", "/bilgi/uyumluluk", "/bilgi/yardim", ...legalLinks.map(page => `/${page.slug}`)].map(path => ({ url: `${siteUrl}${path}` })),
    ...rows.map(product => ({ url: `${siteUrl}/urun/${product.id}`, lastModified: product.updated_at })),
  ];
}
