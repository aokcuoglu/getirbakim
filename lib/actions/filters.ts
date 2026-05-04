'use server'

/**
 * NOTE: This file previously used 'filters' and 'manufacturers' tables
 * which do not exist in the current database schema.
 * These functions are kept as stubs for backwards compatibility.
 */

// Category slug to ID mapping
const CATEGORY_SLUGS: Record<string, { id: number; name: string }> = {
  'oil-filters': { id: 242, name: 'Oil filters' },
  'air-filters': { id: 241, name: 'Air filters' },
  'pollen-filters': { id: 243, name: 'Pollen filters' },
  'fuel-filters': { id: 244, name: 'Fuel filters' },
  'hydraulic-filters': { id: 245, name: 'Hydraulic filters' },
  'coolant-filters': { id: 260, name: 'Coolant filters' },
  'power-steering-filters': { id: 261, name: 'Power steering filters' },
  'filter-sets': { id: 262, name: 'Filter sets' }
}

export type CategoryFilter = {
  id: number
  entityId: string | null
  name: string
  sku: string
  urlKey: string | null
  price: number
  formattedPrice: string
  brandName: string
  brandLogo: string | null
  imageUrl: string
  inStock: boolean
  deliveryDate: string | null
  rating: number
  attributes: Record<string, string>[]
}

export type CategoryInfo = {
  id: number
  name: string
  slug: string
  productCount: number
  rating: number
}

export type BrandInfo = {
  id: number
  name: string
  count: number
  logo: string | null
}

export async function getCategoryBySlug(
  slug: string
): Promise<CategoryInfo | null> {
  const category = CATEGORY_SLUGS[slug]
  if (!category) return null

  // Return static data since filters table doesn't exist
  return {
    id: category.id,
    name: category.name,
    slug,
    productCount: 0,
    rating: 4.5
  }
}

export async function getBrandsByCategory(slug: string): Promise<BrandInfo[]> {
  const category = CATEGORY_SLUGS[slug]
  if (!category) return []

  // Return empty since filters/manufacturers tables don't exist
  return []
}

export async function getFiltersByCategory(
  slug: string,
  page: number = 1,
  brandIds?: number[]
): Promise<{
  items: CategoryFilter[]
  totalCount: number
  totalPages: number
}> {
  const category = CATEGORY_SLUGS[slug]
  if (!category) {
    return { items: [], totalCount: 0, totalPages: 0 }
  }

  // Return empty since filters table doesn't exist
  return { items: [], totalCount: 0, totalPages: 0 }
}

export async function getCategorySlugList(): Promise<string[]> {
  return Object.keys(CATEGORY_SLUGS)
}
