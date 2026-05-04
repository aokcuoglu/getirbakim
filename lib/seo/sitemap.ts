import { db } from '@/lib/db'
import { resolveSiteUrl } from '@/lib/site-url'

export function toCategorySlug(urlKey: string | null | undefined, name: string): string {
  const fromUrlKey = (urlKey || '').trim().toLowerCase()
  if (fromUrlKey) {
    return fromUrlKey.replace(/-\d{5,}$/, '')
  }

  return name
    .toLowerCase()
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/[ıİ]/g, 'i')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function getCanonicalSiteUrl(): string {
  return resolveSiteUrl().replace(/\/$/, '')
}

export async function getActiveCategorySlugs(): Promise<string[]> {
  const categories = await db.part_categories.findMany({
    where: { is_active: true },
    select: { name: true, url_key: true }
  })

  const slugSet = new Set<string>()
  for (const category of categories) {
    const slug = toCategorySlug(category.url_key, category.name)
    if (slug) slugSet.add(slug)
  }

  return Array.from(slugSet)
}

export function buildSitemapXml(urls: string[], nowIso: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (url) =>
        `  <url><loc>${escapeXml(url)}</loc><lastmod>${nowIso}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`
    )
    .join('\n')}\n</urlset>`
}
