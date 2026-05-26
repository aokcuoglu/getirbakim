import { notFound, permanentRedirect } from 'next/navigation'
import { getDbrandsMatchById } from '@/lib/v0/getDbrandsMatch'
import { buildBrandHref } from '@/lib/v0/brandSlug'

interface LegacyBrandRedirectProps {
  params: Promise<{
    locale: string
    id: string
  }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function LegacyBrandRedirect({
  params,
  searchParams
}: LegacyBrandRedirectProps) {
  const { locale, id } = await params
  const brandMatchId = parseInt(id, 10)

  if (isNaN(brandMatchId)) {
    notFound()
  }

  const brand = await getDbrandsMatchById(brandMatchId)
  if (!brand) {
    notFound()
  }

  const resolvedSearchParams = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (typeof value === 'string') {
      query.set(key, value)
    } else if (Array.isArray(value)) {
      for (const item of value) {
        query.append(key, item)
      }
    }
  }

  const queryString = query.toString()
  const target = `${buildBrandHref(locale, brand.slug)}${queryString ? `?${queryString}` : ''}`
  permanentRedirect(target)
}
