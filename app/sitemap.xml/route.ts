import {
  buildSitemapXml,
  getActiveCategorySlugs,
  getCanonicalSiteUrl
} from '@/lib/seo/sitemap'
import { isIndexingAllowed } from '@/lib/site-url'

export const dynamic = 'force-dynamic'

export async function GET() {
  const baseUrl = getCanonicalSiteUrl()

  if (!isIndexingAllowed()) {
    return new Response('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>', {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'X-Robots-Tag': 'noindex'
      }
    })
  }

  const slugs = await getActiveCategorySlugs()
  const locales: Array<'en' | 'tr'> = ['en', 'tr']

  const urls: string[] = []
  locales.forEach((locale) => {
    urls.push(`${baseUrl}/${locale}`)
    slugs.forEach((slug) => {
      urls.push(`${baseUrl}/${locale}/${slug}`)
    })
  })

  const now = new Date().toISOString()
  const body = buildSitemapXml(Array.from(new Set(urls)), now)

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
    }
  })
}
