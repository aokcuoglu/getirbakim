import { toCategorySlug } from '@/lib/seo/sitemap'

/**
 * Marka sayfası slug'ı. `storedSlug` catalog.brands.slug'tan gelir; boşsa
 * marka adından türetilir.
 */
export function toBrandSlug(
  storedSlug: string | null | undefined,
  brandName: string
): string {
  return toCategorySlug(storedSlug, brandName)
}

export function buildBrandPath(slug: string): string {
  return `/b/${slug}`
}

export function buildBrandHref(locale: string, slug: string): string {
  return `/${locale}/b/${slug}`
}
