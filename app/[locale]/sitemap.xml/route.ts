import {
  buildSitemapXml,
  getActiveCategorySlugs,
  getCanonicalSiteUrl
} from '@/lib/seo/sitemap'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ locale: string }> }
) {
  const { locale } = await context.params
  const safeLocale = locale === 'tr' ? 'tr' : 'en'
  const baseUrl = getCanonicalSiteUrl()
  const slugs = await getActiveCategorySlugs()

  const urls = [
    `${baseUrl}/${safeLocale}`,
    ...slugs.map((slug) => `${baseUrl}/${safeLocale}/${slug}`)
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
