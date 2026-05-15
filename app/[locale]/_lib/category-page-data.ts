import { notFound } from 'next/navigation'
import { getCategoryByUrlKey, getTopCategories } from '@/lib/actions/getPartCategories'
import { getPopularManufacturers, type PopularManufacturer } from '@/lib/actions/getPopularManufacturers'
import { extractVehicleTypeIdFromSlug } from '@/lib/utils/vehicleSlug'
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
  popularManufacturers: PopularManufacturer[]
}

export interface CategoryShellPayload {
  locale: string
  url: string
  category: TrodoCategoryWithHierarchy
  variantSlug?: string
  resolvedVehicleId: number | null
  vehicleResolutionFailed: boolean
  isLeaf: boolean
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

export async function resolveDefaultCategorySlug(locale: string) {
  const topCategories = await getTopCategories(locale)
  const defaultCategory = topCategories.find((item) => Boolean(item.urlKey))

  if (!defaultCategory?.urlKey) {
    notFound()
  }

  return defaultCategory.urlKey
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

  const tPopular = tg.start('popularManufacturers')
  const popularManufacturers = category.isLeaf
    ? []
    : await getPopularManufacturers()
  tg.end(tPopular)
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
    popularManufacturers
  }
}

export async function buildCategoryShellPayload({
  locale,
  categorySlug,
  searchParams,
  preResolvedCategory
}: {
  locale: string
  categorySlug: string
  searchParams: CategoryRouteSearchParams
  preResolvedCategory?: TrodoCategoryWithHierarchy
}): Promise<CategoryShellPayload | null> {
  const tg = createTimerGroup('categoryShellPayload')
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

  const tPopular = tg.start('popularManufacturers')
  const popularManufacturers = category.isLeaf
    ? []
    : await getPopularManufacturers()
  tg.end(tPopular)
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
    isLeaf: category.isLeaf,
    popularManufacturers
  }
}