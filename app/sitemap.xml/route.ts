import { getApprovedDbrandsMatch } from '@/lib/v0/getDbrandsMatch'
import { buildBrandPath } from '@/lib/v0/brandSlug'
import { isIndexingAllowed, resolveSiteUrl } from '@/lib/site-url'

export const dynamic = 'force-dynamic'

export async function GET() {
  const baseUrl = resolveSiteUrl()

  if (!isIndexingAllowed()) {
    return new Response('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>', {
      headers: { 'Content-Type': 'application/xml; charset=utf-8' }
    })
  }

  const brands = await getApprovedDbrandsMatch()

  const urls = [
    baseUrl,
    ...brands.map((brand) => `${baseUrl}${buildBrandPath(brand.slug)}`)
  ]

  const now = new Date().toISOString()
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${url}</loc><lastmod>${now}</lastmod></url>`).join('\n')}
</urlset>`

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
    }
  })
}
