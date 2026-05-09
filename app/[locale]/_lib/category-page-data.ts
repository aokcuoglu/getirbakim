import { notFound } from 'next/navigation'
import { getCategoryByUrlKey, getTopCategories } from '@/lib/actions/getPartCategories'
import { getPopularManufacturers, type PopularManufacturer } from '@/lib/actions/getPopularManufacturers'
import { extractVehicleTypeIdFromSlug } from '@/lib/utils/vehicleSlug'
import {
  getCatalogArticles,
  type CatalogArticlesResult,
  type SortOption
} from '@/lib/actions/getCatalogArticles'
import { buildCategoryUrl } from '@/lib/catalog-url'
import type { TrodoCategoryWithHierarchy } from '@/lib/actions/getPartCategories'
import { createTimerGroup } from '@/lib/performance/timing'

export interface CategoryRouteSearchParams {
  [key: string]: string | string[] | undefined
}

export interface CategoryPagePayload {
  locale: string
  url: string
  category: TrodoCategoryWithHierarchy
  variantSlug?: string
  resolvedVehicleId: number | null
  vehicleResolutionFailed: boolean
  initialData?: CatalogArticlesResult
  popularManufacturers: PopularManufacturer[]
}

export function getSearchParamValue(
  searchParams: CategoryRouteSearchParams,
  key: string
): string | undefined {
  const value = searchParams[key]
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

function parseDelimitedParam(
  searchParams: CategoryRouteSearchParams,
  key: string
): string[] {
  const value = getSearchParamValue(searchParams, key)
  return value
    ? value
        .split('|')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

function parseNumberParam(
  searchParams: CategoryRouteSearchParams,
  key: string
): number | undefined {
  const value = getSearchParamValue(searchParams, key)
  if (!value) return undefined

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseSortParam(
  searchParams: CategoryRouteSearchParams
): SortOption | undefined {
  const sort = getSearchParamValue(searchParams, 'sort')
  if (
    sort === 'popularity' ||
    sort === 'price-asc' ||
    sort === 'price-desc' ||
    sort === 'name'
  ) {
    return sort
  }

  return undefined
}

export async function resolveDefaultCategorySlug(locale: string) {
  const topCategories = await getTopCategories(locale)
  const defaultCategory = topCategories.find((item) => Boolean(item.urlKey))

  if (!defaultCategory?.urlKey) {
    notFound()
  }

  return defaultCategory.urlKey
}

async function getInitialLeafData(
  categoryName: string,
  searchIds: number[],
  resolvedVehicleId: number | null,
  searchParams: CategoryRouteSearchParams
): Promise<CatalogArticlesResult> {
  return getCatalogArticles({
    categoryName,
    searchIds,
    vehicleId: resolvedVehicleId,
    brands: parseDelimitedParam(searchParams, 'brands'),
    stockStatuses: parseDelimitedParam(searchParams, 'stock'),
    page: parseNumberParam(searchParams, 'page'),
    limit: parseNumberParam(searchParams, 'limit'),
    sort: parseSortParam(searchParams),
    minPrice: parseNumberParam(searchParams, 'minPrice'),
    maxPrice: parseNumberParam(searchParams, 'maxPrice'),
    includePrice: true,
    includeHits: true,
    includeTotal: true,
    includeFacets: true
  })
}

export async function buildCategoryPagePayload({
  locale,
  categorySlug,
  searchParams,
  preResolvedCategory
}: {
  locale: string
  categorySlug: string
  searchParams: CategoryRouteSearchParams
  preResolvedCategory?: TrodoCategoryWithHierarchy
}): Promise<CategoryPagePayload | null> {
  const tg = createTimerGroup('categoryPagePayload')
  const tResolve = tg.start('resolveCategory')

  const variantSlug = getSearchParamValue(searchParams, 'variant')
  const resolvedVehicleId = variantSlug
    ? extractVehicleTypeIdFromSlug(variantSlug)
    : null
  const vehicleResolutionFailed = Boolean(variantSlug) && !resolvedVehicleId

  const category = preResolvedCategory ?? (await getCategoryByUrlKey(categorySlug))
  if (!category?.urlKey) {
    return null
  }
  tg.end(tResolve)

  const canonicalSearchParams: Record<string, string> = {}
  Object.entries(searchParams).forEach(([key, value]) => {
    if (!value || key === 'cat' || key === 'variant') return

    if (Array.isArray(value)) {
      if (value[0]) {
        canonicalSearchParams[key] = value[0]
      }
      return
    }

    canonicalSearchParams[key] = value
  })

  const tData = tg.start('fetchData')
  const [popularManufacturers, initialData] = await Promise.all([
    category.isLeaf ? Promise.resolve([]) : getPopularManufacturers(),
    category.isLeaf
      ? getInitialLeafData(
          category.name,
          category.searchIds,
          resolvedVehicleId,
          searchParams
        )
      : Promise.resolve(undefined)
  ])
  tg.end(tData)
  tg.logSummary()

  return {
    locale,
    url: buildCategoryUrl(locale, {
      categoryUrlKey: category.urlKey,
      variantSlug: variantSlug ?? null,
      searchParams: canonicalSearchParams
    }),
    category,
    variantSlug,
    resolvedVehicleId,
    vehicleResolutionFailed,
    initialData,
    popularManufacturers
  }
}
