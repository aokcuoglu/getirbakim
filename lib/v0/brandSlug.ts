function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9çğıöşü]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function toBrandSlug(
  ptUrlKey: string | null | undefined,
  brandName: string
): string {
  if (ptUrlKey) return toSlug(ptUrlKey)
  return toSlug(brandName)
}

export function buildBrandPath(slug: string): string {
  return `/b/${slug}`
}

export function buildBrandHref(locale: string, slug: string): string {
  return `/${locale}/b/${slug}`
}
