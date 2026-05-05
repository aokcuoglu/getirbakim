import type { MetadataRoute } from 'next'
import { resolveSiteUrl, isIndexingAllowed } from '@/lib/site-url'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = resolveSiteUrl().replace(/\/$/, '')
  const allowIndexing = isIndexingAllowed()

  return {
    rules: {
      userAgent: '*',
      allow: allowIndexing ? '/' : '',
      disallow: allowIndexing ? '' : '/'
    },
    sitemap: allowIndexing ? `${baseUrl}/sitemap.xml` : undefined,
    host: allowIndexing ? baseUrl : undefined
  }
}
