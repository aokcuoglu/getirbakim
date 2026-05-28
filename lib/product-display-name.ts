export function stripLeadingBrandPrefix(rawName: string, brandName: string): string {
  if (!rawName || !brandName) return rawName || ''
  const lowerRaw = rawName.toLowerCase().trim()
  const lowerBrand = brandName.toLowerCase().trim()
  if (lowerRaw.startsWith(lowerBrand)) {
    const afterBrand = rawName.slice(lowerBrand.length).trim()
    if (afterBrand) return afterBrand
  }
  return rawName
}

export function buildProductDisplayName(options: {
  name: string
  brandName?: string | null
  categoryName?: string | null
}): string {
  const { name, brandName } = options
  if (!name) return ''
  if (brandName) {
    const stripped = stripLeadingBrandPrefix(name, brandName)
    return stripped || name
  }
  return name
}
