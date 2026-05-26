import { toCategorySlug } from '@/lib/seo/sitemap'

export function toBrandSlug(
  ptUrlKey: string | null | undefined,
  brandName: string
): string {
  return toCategorySlug(ptUrlKey, brandName)
}

export function buildBrandPath(slug: string): string {
  return `/b/${slug}`
}

export function buildBrandHref(locale: string, slug: string): string {
  return `/${locale}/b/${slug}`
}
