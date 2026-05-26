import {
  buildSitemapXml,
  getActiveCategorySlugs,
  getCanonicalSiteUrl
} from '@/lib/seo/sitemap'
import { getApprovedDbrandsMatch } from '@/lib/v0/getDbrandsMatch'
import { buildBrandPath } from '@/lib/v0/brandSlug'
import { isIndexingAllowed } from '@/lib/site-url'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ locale: string }> }
) {
  if (!isIndexingAllowed()) {
    return new Response('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>', {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'X-Robots-Tag': 'noindex'
      }
    })
  }

  const { locale } = await context.params
  const safeLocale = locale === 'tr' ? 'tr' : 'en'
  const baseUrl = getCanonicalSiteUrl()
  const [slugs, brands] = await Promise.all([
    getActiveCategorySlugs(),
    getApprovedDbrandsMatch()
  ])

  const urls = [
    `${baseUrl}/${safeLocale}`,
    ...slugs.map((slug) => `${baseUrl}/${safeLocale}/${slug}`),
    ...brands.map((brand) => `${baseUrl}/${safeLocale}${buildBrandPath(brand.slug)}`)
  ]

  const now = new Date().toISOString()
  const body = buildSitemapXml(urls, now)

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
    }
  })
}
