import {
  buildSitemapXml,
  getActiveCategorySlugs,
  getCanonicalSiteUrl
} from '@/lib/seo/sitemap'

export const dynamic = 'force-dynamic'

export async function GET() {
  const baseUrl = getCanonicalSiteUrl()
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
