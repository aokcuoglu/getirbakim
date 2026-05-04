interface BuildProductDisplayNameParams {
  categoryName?: string | null
  brandName?: string | null
  name: string
}

export function buildProductDisplayName({
  categoryName,
  brandName,
  name
}: BuildProductDisplayNameParams) {
  return [categoryName, brandName, name]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(' ')
}
