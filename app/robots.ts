import type { MetadataRoute } from 'next'
import { resolveSiteUrl } from '@/lib/site-url'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = resolveSiteUrl().replace(/\/$/, '')

  return {
    rules: {
      userAgent: '*',
      allow: '/'
    },
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl
  }
}
