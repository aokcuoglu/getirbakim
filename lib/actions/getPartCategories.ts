'use server'

import { db } from '@/lib/db'
import { getFromCache, setCache } from '@/lib/redis'
import { cache } from 'react'

export interface PartCategory {
  id: number
  name: string
  nameTr: string | null
  isActive?: boolean
  hasChildren: boolean
  parentId: number | null
  urlKey: string | null
  image?: string | null
  children?: PartCategory[]
  partCount?: number // Number of parts in this category (for vehicle filtering)
}

// Helper to generate slug from name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/[ıİ]/g, 'i')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

function normalizeUrlKey(
  urlKey: string | null | undefined,
  name: string
): string {
  const candidate = (urlKey || '').trim().toLowerCase()
  if (!candidate) return generateSlug(name)

  // Backward-compat: old entries may be "slug-100384"
  return candidate.replace(/-\d{5,}$/, '')
}

// Parse category id from url_key: "air-filter-100384" -> 100384
function parseIdFromUrlKey(urlKey: string): number | null {
  const match = urlKey.match(/-(\d+)$/)
  return match ? parseInt(match[1], 10) : null
}

// Helper to sort categories by localized name
function sortCategoriesByName(
  categories: PartCategory[],
  locale: string = 'en'
): PartCategory[] {
  return categories.sort((a, b) => {
    const nameA = locale === 'tr' && a.nameTr ? a.nameTr : a.name
    const nameB = locale === 'tr' && b.nameTr ? b.nameTr : b.name
    return nameA.localeCompare(nameB, locale)
  })
}

// Helper to recursively sort all children
function sortCategoryTree(
  categories: PartCategory[],
  locale: string = 'en'
): PartCategory[] {
  const sorted = sortCategoriesByName(categories, locale)
  sorted.forEach((cat) => {
    if (cat.children && cat.children.length > 0) {
      cat.children = sortCategoryTree(cat.children, locale)
    }
  })
  return sorted
}

function hasAccessibleAncestry(
  categoryId: number,
  parentMap: Map<number, number | null>
): boolean {
  const visited = new Set<number>()
  let currentId: number | null | undefined = categoryId

  while (currentId != null) {
    if (visited.has(currentId)) {
      return false
    }
    visited.add(currentId)

    const parentId = parentMap.get(currentId)
    if (parentId === undefined) {
      return false
    }

    currentId = parentId
  }

  return true
}

async function fetchPartCategories(
  locale: string = 'en'
): Promise<PartCategory[]> {
  // Fetch all part categories
  const allCategories = await db.part_categories.findMany({
    where: {
      is_active: true
    },
    select: {
      id: true,
      name: true,
      name_tr: true,
      is_active: true,
      has_childs: true,
      parent_id: true,
      url_key: true,
      image: true
    }
  })

  // Build category map for tree structure
  const categoryMap = new Map<number, PartCategory>()

  // First pass: Create all nodes
  allCategories.forEach((cat) => {
    categoryMap.set(cat.id, {
      id: cat.id,
      name: cat.name,
      nameTr: cat.name_tr,
      isActive: cat.is_active,
      hasChildren: cat.has_childs,
      parentId: cat.parent_id,
      urlKey: normalizeUrlKey(cat.url_key, cat.name),
      image: cat.image,
      children: []
    })
  })

  // Second pass: Link children to parents
  categoryMap.forEach((cat) => {
    if (cat.parentId) {
      const parent = categoryMap.get(cat.parentId)
      if (parent) {
        parent.children?.push(cat)
      }
    }
  })

  // Return only root categories (those without parent_id)
  const rootCategories: PartCategory[] = []
  categoryMap.forEach((cat) => {
    if (!cat.parentId) {
      rootCategories.push(cat)
    }
  })

  // Sort entire tree by localized name
  return sortCategoryTree(rootCategories, locale)
}

// Fetch categories filtered by vehicle (only categories with parts for that vehicle)
async function fetchPartCategoriesForVehicle(
  vehicleTypeId: number,
  locale: string = 'en'
): Promise<PartCategory[]> {
  // Derive vehicle->category mapping dynamically through part_vehicle_types->parts
  const variantCategoryRows = await db.part_vehicle_types.findMany({
    where: {
      vehicle_type_id: vehicleTypeId
    },
    select: {
      parts: {
        select: {
          category_id: true
        }
      }
    }
  })

  // Extract unique category IDs
  const categoryIdSet = new Set<number>()
  variantCategoryRows.forEach((row) => {
    if (row.parts?.category_id) {
      categoryIdSet.add(row.parts.category_id)
    }
  })

  if (categoryIdSet.size === 0) {
    return []
  }

  // Fetch all part categories
  const allCategories = await db.part_categories.findMany({
    where: {
      is_active: true
    },
    select: {
      id: true,
      name: true,
      name_tr: true,
      is_active: true,
      has_childs: true,
      parent_id: true,
      url_key: true,
      image: true
    }
  })

  // Build category map
  const categoryMap = new Map<number, PartCategory>()

  allCategories.forEach((cat) => {
    categoryMap.set(cat.id, {
      id: cat.id,
      name: cat.name,
      nameTr: cat.name_tr,
      isActive: cat.is_active,
      hasChildren: cat.has_childs,
      parentId: cat.parent_id,
      urlKey: normalizeUrlKey(cat.url_key, cat.name),
      image: cat.image,
      children: [],
      partCount: categoryIdSet.has(cat.id) ? 1 : 0
    })
  })

  // Link children to parents
  categoryMap.forEach((cat) => {
    if (cat.parentId) {
      const parent = categoryMap.get(cat.parentId)
      if (parent) {
        parent.children?.push(cat)
      }
    }
  })

  // Propagate partCount up the tree (if a child has parts, parent should be included)
  function propagatePartCount(cat: PartCategory): number {
    let count = cat.partCount || 0
    if (cat.children) {
      cat.children.forEach((child) => {
        count += propagatePartCount(child)
      })
    }
    cat.partCount = count
    return count
  }

  // Filter tree to only include categories with parts
  function filterCategoriesWithParts(
    categories: PartCategory[]
  ): PartCategory[] {
    return categories
      .filter((cat) => (cat.partCount || 0) > 0)
      .map((cat) => ({
        ...cat,
        children: cat.children ? filterCategoriesWithParts(cat.children) : []
      }))
  }

  // Get root categories and propagate part counts
  const rootCategories: PartCategory[] = []
  categoryMap.forEach((cat) => {
    if (!cat.parentId) {
      propagatePartCount(cat)
      rootCategories.push(cat)
    }
  })

  // Filter and sort
  const filtered = filterCategoriesWithParts(rootCategories)
  return sortCategoryTree(filtered, locale)
}

// Cache for 1 hour
export const getPartCategories = async (
  locale: string = 'en'
): Promise<PartCategory[]> => {
  const cacheKey = `part-categories-tree-${locale}-v2`

  const cached = await getFromCache<PartCategory[]>(cacheKey)
  if (cached) {
    return cached
  }

  const categories = await fetchPartCategories(locale)
  await setCache(cacheKey, categories, 3600)
  return categories
}

// Get categories filtered by vehicle
export const getPartCategoriesForVehicle = async (
  vehicleTypeId: number,
  locale: string = 'en'
): Promise<PartCategory[]> => {
  const cacheKey = `part-categories-vehicle-${vehicleTypeId}-${locale}-v2`

  const cached = await getFromCache<PartCategory[]>(cacheKey)
  if (cached) {
    return cached
  }

  const categories = await fetchPartCategoriesForVehicle(vehicleTypeId, locale)
  await setCache(cacheKey, categories, 1800) // 30 minutes cache for vehicle-specific
  return categories
}

export interface PartCategoryWithHierarchy extends PartCategory {
  breadcrumbs: { name: string; nameTr: string | null; urlKey: string }[]
  isLeaf: boolean
  searchIds: number[]
  siblings?: PartCategory[]
  image?: string | null // For compatibility with old trodo system
}

// Alias for backward compatibility with code that used TrodoCategory
export type TrodoCategory = PartCategory
export type TrodoCategoryWithHierarchy = PartCategoryWithHierarchy

// Get category by url_key with hierarchy
// Canonical URL format: "air-filter"
// Legacy URL format is still supported: "air-filter-100384"
export const getPartCategoryByUrlKey = cache(
  async (urlKey: string): Promise<PartCategoryWithHierarchy | null> => {
    const cacheKey = `part-category-v2-${urlKey}`
    const cached = await getFromCache<PartCategoryWithHierarchy>(cacheKey)
    if (cached) {
      const normalizedKey = normalizeUrlKey(cached.urlKey, cached.name)
      if (normalizedKey !== cached.urlKey) {
        const next = { ...cached, urlKey: normalizedKey }
        await setCache(cacheKey, next, 3600)
        return next
      }
      return cached
    }

    const legacyCategoryId = parseIdFromUrlKey(urlKey)

    // Fetch all categories to build the tree (needed for children and breadcrumbs)
    const allCategories = await db.part_categories.findMany({
      where: {
        is_active: true
      },
      select: {
        id: true,
        name: true,
        name_tr: true,
        is_active: true,
        has_childs: true,
        parent_id: true,
        url_key: true,
        image: true
      }
    })

    // Build category map
    const categoryMap = new Map<
      number,
      PartCategory & { children: PartCategory[] }
    >()
    allCategories.forEach((cat) => {
      const catUrlKey = normalizeUrlKey(cat.url_key, cat.name)
      categoryMap.set(cat.id, {
        id: cat.id,
        name: cat.name,
        nameTr: cat.name_tr,
        isActive: cat.is_active,
        hasChildren: cat.has_childs,
        parentId: cat.parent_id,
        urlKey: catUrlKey,
        image: cat.image,
        children: []
      })
    })

    // Link children to parents
    categoryMap.forEach((cat) => {
      if (cat.parentId) {
        const parent = categoryMap.get(cat.parentId)
        if (parent) {
          parent.children.push(cat)
        }
      }
    })

    const normalizedInput = normalizeUrlKey(urlKey, urlKey)

    let targetCategory = legacyCategoryId
      ? categoryMap.get(legacyCategoryId)
      : null

    if (!targetCategory) {
      const slugMatches = Array.from(categoryMap.values()).filter(
        (cat) => cat.urlKey === normalizedInput
      )

      if (slugMatches.length === 0) {
        return null
      }

      slugMatches.sort((a, b) => {
        const childDiff = (b.children?.length ?? 0) - (a.children?.length ?? 0)
        if (childDiff !== 0) return childDiff

        if (a.hasChildren !== b.hasChildren) {
          return a.hasChildren ? -1 : 1
        }

        if ((a.parentId == null) !== (b.parentId == null)) {
          return a.parentId == null ? -1 : 1
        }

        return a.id - b.id
      })

      targetCategory = slugMatches[0]
    }

    const parentMap = new Map(
      allCategories.map((category) => [category.id, category.parent_id])
    )

    if (!hasAccessibleAncestry(targetCategory.id, parentMap)) {
      return null
    }

    // Build breadcrumbs
    const breadcrumbs: {
      name: string
      nameTr: string | null
      urlKey: string
    }[] = []
    let currentId: number | null = targetCategory.parentId
    while (currentId) {
      const parent = categoryMap.get(currentId)
      if (parent) {
        breadcrumbs.unshift({
          name: parent.name,
          nameTr: parent.nameTr,
          urlKey: parent.urlKey!
        })
        currentId = parent.parentId
      } else {
        break
      }
    }

    // Get siblings if it has a parent
    let siblings: PartCategory[] = []
    if (targetCategory.parentId) {
      const parent = categoryMap.get(targetCategory.parentId)
      if (parent) {
        siblings = parent.children
      }
    } else {
      // Top-level categories are siblings of each other
      categoryMap.forEach((cat) => {
        if (!cat.parentId) {
          siblings.push(cat)
        }
      })
    }

    // Sort siblings by name
    siblings = sortCategoriesByName(siblings, 'en') // Default to en, but could be passed in

    // Category ids for this category
    const searchIds = [targetCategory.id]

    const result: PartCategoryWithHierarchy = {
      id: targetCategory.id,
      name: targetCategory.name,
      nameTr: targetCategory.nameTr,
      hasChildren: targetCategory.hasChildren,
      parentId: targetCategory.parentId,
      urlKey: targetCategory.urlKey,
      image: targetCategory.image,
      children: targetCategory.children,
      breadcrumbs,
      isLeaf:
        !targetCategory.hasChildren && targetCategory.children.length === 0,
      searchIds,
      siblings
    }

    await setCache(cacheKey, result, 3600)
    return result
  }
)

// Alias for backward compatibility
export const getCategoryByUrlKey = getPartCategoryByUrlKey

// Main nav categories from DB: is_main_nav=true (can have parent_id or be root)
// Expected: Car parts (1000000), Lubrication (100245), Filters (100005), Window Cleaning (100018), Accessories (100733).
// After migration or schema changes, run: bun run clear-category-cache
export const getMainNavCategories = async (
  locale: string = 'en'
): Promise<PartCategory[]> => {
  const cacheKey = `main-nav-categories-${locale}-v2`
  const cached = await getFromCache<PartCategory[]>(cacheKey)
  if (cached) return cached

  const rows = await db.part_categories.findMany({
    where: { is_main_nav: true, is_active: true },
    select: {
      id: true,
      name: true,
      name_tr: true,
      is_active: true,
      has_childs: true,
      parent_id: true,
      url_key: true,
      image: true
    },
    orderBy: { id: 'asc' }
  })

  const categories: PartCategory[] = rows.map((cat) => ({
    id: cat.id,
    name: locale === 'tr' && cat.name_tr ? cat.name_tr : cat.name,
    nameTr: cat.name_tr,
    isActive: cat.is_active,
    hasChildren: cat.has_childs,
    parentId: cat.parent_id,
    urlKey: normalizeUrlKey(cat.url_key, cat.name),
    image: cat.image
  }))

  await setCache(cacheKey, categories, 3600)
  return categories
}

// Get top-level categories for navigation
export const getTopCategories = async (
  locale: string = 'en'
): Promise<PartCategory[]> => {
  const cacheKey = `top-categories-${locale}-v2`
  const cached = await getFromCache<PartCategory[]>(cacheKey)
  if (cached) return cached

  // Fetch root categories (those without parent)
  const rootCategories = await db.part_categories.findMany({
    where: { parent_id: null, is_active: true },
    select: {
      id: true,
      name: true,
      name_tr: true,
      is_active: true,
      has_childs: true,
      parent_id: true,
      url_key: true,
      image: true
    }
  })

  const categories: PartCategory[] = rootCategories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    nameTr: cat.name_tr,
    isActive: cat.is_active,
    hasChildren: cat.has_childs,
    parentId: cat.parent_id,
    urlKey: normalizeUrlKey(cat.url_key, cat.name),
    image: cat.image
  }))

  // Sort by localized name
  const sorted = sortCategoriesByName(categories, locale)
  await setCache(cacheKey, sorted, 3600)
  return sorted
}

// Get category id from urlKey (for parts filtering). Kept name for backward compatibility.
export const getCategorySearchIdFromUrlKey = async (
  urlKey: string
): Promise<number | null> => {
  // First try to parse id from urlKey format: "air-filter-100384"
  const id = parseIdFromUrlKey(urlKey)
  if (id) {
    // Verify it exists
    const exists = await db.part_categories.findUnique({
      where: { id },
      select: { id: true, is_active: true, parent_id: true }
    })
    if (!exists?.is_active) {
      return null
    }

    const activeCategories = await db.part_categories.findMany({
      where: { is_active: true },
      select: { id: true, parent_id: true }
    })
    const parentMap = new Map(
      activeCategories.map((category) => [category.id, category.parent_id])
    )

    return hasAccessibleAncestry(id, parentMap) ? exists.id : null
  }

  // Fallback: search by canonical slug
  const allCategories = await db.part_categories.findMany({
    where: { is_active: true },
    select: { id: true, name: true, url_key: true, parent_id: true }
  })

  const parentMap = new Map(
    allCategories.map((category) => [category.id, category.parent_id])
  )

  // Find category whose canonical slug matches
  for (const cat of allCategories) {
    const slug = normalizeUrlKey(cat.url_key, cat.name)
    if (slug === urlKey && hasAccessibleAncestry(cat.id, parentMap)) {
      return cat.id
    }
  }

  return null
}
