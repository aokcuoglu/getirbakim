type CatalogParamValue = string | number | boolean | null | undefined

interface BuildCatalogUrlOptions {
  categoryUrlKey?: string | null
  variantSlug?: string | null
  searchParams?: Record<string, CatalogParamValue>
}

function buildCategoryQuery({
  categoryUrlKey,
  variantSlug,
  searchParams
}: BuildCatalogUrlOptions = {}): string {
  const params = new URLSearchParams()

  if (variantSlug) {
    params.set('variant', variantSlug)
  }

  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') return
      params.set(key, String(value))
    })
  }

  return params.toString()
}

function normalizeCategoryUrlKey(categoryUrlKey?: string | null): string {
  const normalized = categoryUrlKey?.trim()
  return normalized && normalized.length > 0 ? normalized : 'car-parts'
}

export function buildCategoryPath(options: BuildCatalogUrlOptions = {}): string {
  const categoryUrlKey = normalizeCategoryUrlKey(options.categoryUrlKey)
  const query = buildCategoryQuery(options)
  return query ? `/${categoryUrlKey}?${query}` : `/${categoryUrlKey}`
}

export function buildCategoryUrl(
  locale: string,
  { categoryUrlKey, variantSlug, searchParams }: BuildCatalogUrlOptions = {}
): string {
  const categoryUrlKeyNormalized = normalizeCategoryUrlKey(categoryUrlKey)
  const query = buildCategoryQuery({
    categoryUrlKey: categoryUrlKeyNormalized,
    variantSlug,
    searchParams
  })
  return query
    ? `/${locale}/${categoryUrlKeyNormalized}?${query}`
    : `/${locale}/${categoryUrlKeyNormalized}`
}

export function buildCatalogAliasPath(
  options: BuildCatalogUrlOptions = {}
): string {
  const params = new URLSearchParams()
  const categoryUrlKey = normalizeCategoryUrlKey(options.categoryUrlKey)

  if (categoryUrlKey) {
    params.set('cat', categoryUrlKey)
  }

  const categoryQuery = buildCategoryQuery(options)
  const extraParams = new URLSearchParams(categoryQuery)
  extraParams.forEach((value, key) => {
    params.set(key, value)
  })

  const query = params.toString()
  return query ? `/catalog?${query}` : '/catalog'
}

export function buildCatalogAliasUrl(
  locale: string,
  options: BuildCatalogUrlOptions = {}
): string {
  const query = buildCatalogAliasPath(options)
  return `/${locale}${query}`
}

// Backward-compatible exports used throughout the app. These now produce the
// canonical slug route so internal category links never bounce through /catalog.
export function buildCatalogPath(options: BuildCatalogUrlOptions = {}): string {
  return buildCategoryPath(options)
}

export function buildCatalogUrl(
  locale: string,
  options: BuildCatalogUrlOptions = {}
): string {
  return buildCategoryUrl(locale, options)
}
