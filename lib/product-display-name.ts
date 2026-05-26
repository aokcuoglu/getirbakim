interface BuildProductDisplayNameParams {
  categoryName?: string | null
  brandName?: string | null
  name: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function stripLeadingBrandPrefix(
  name: string,
  brandName?: string | null
): string {
  const brand = brandName?.trim()
  if (!brand) {
    return name.trim()
  }

  let result = name.trim()
  const pattern = new RegExp(`^${escapeRegExp(brand)}\\s+`, 'i')

  while (pattern.test(result)) {
    result = result.replace(pattern, '').trim()
  }

  return result || name.trim()
}

export function buildProductDisplayName({
  categoryName,
  brandName,
  name
}: BuildProductDisplayNameParams) {
  const normalizedName = stripLeadingBrandPrefix(name, brandName)

  return [categoryName, brandName, normalizedName]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(' ')
}
