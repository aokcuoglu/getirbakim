'use server'

import { db } from '@/lib/db'
import { getFromCache, setCache } from '@/lib/redis'
import { cache } from 'react'
import { createTimerGroup } from '@/lib/performance/timing'

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
  // Use precomputed vehicle_type->category mapping (parts2world spare-groups style)
  const variantCategoryRows = await db.vehicle_types_categories.findMany({
    where: {
      vehicle_types_id: vehicleTypeId
    },
    select: {
      category_id: true
    }
  })

  // Extract unique category IDs
  const categoryIdSet = new Set<number>()
  variantCategoryRows.forEach((row) => {
    if (row.category_id) {
      categoryIdSet.add(row.category_id)
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
  const tg = createTimerGroup('partCategories')
  const tCache = tg.start('cacheLookup')
  const cacheKey = `part-categories-tree-${locale}-v2`

  const cached = await getFromCache<PartCategory[]>(cacheKey)
  if (cached) {
    tg.end(tCache, { hit: true })
    tg.logSummary()
    return cached
  }
  tg.end(tCache, { hit: false })

  const tDb = tg.start('dbQuery')
  const categories = await fetchPartCategories(locale)
  tg.end(tDb)

  const tCacheSet = tg.start('cacheSet')
  await setCache(cacheKey, categories, 3600)
  tg.end(tCacheSet)

  tg.logSummary()
  return categories
}

// Get categories filtered by vehicle
export const getPartCategoriesForVehicle = async (
  vehicleTypeId: number,
  locale: string = 'en'
): Promise<PartCategory[]> => {
  const tg = createTimerGroup('partCategoriesForVehicle')
  const tCache = tg.start('cacheLookup')
  const cacheKey = `part-categories-vehicle-${vehicleTypeId}-${locale}-v2`

  const cached = await getFromCache<PartCategory[]>(cacheKey)
  if (cached) {
    tg.end(tCache, { hit: true })
    tg.logSummary()
    return cached
  }
  tg.end(tCache, { hit: false })

  const tDb = tg.start('dbQuery')
  const categories = await fetchPartCategoriesForVehicle(vehicleTypeId, locale)
  tg.end(tDb)

  const tCacheSet = tg.start('cacheSet')
  await setCache(cacheKey, categories, 1800)
  tg.end(tCacheSet)

  tg.logSummary()
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
    const tg = createTimerGroup('categoryByUrlKey')
    const tCache = tg.start('cacheLookup')
    const cacheKey = `part-category-v2-${urlKey}`
    const cached = await getFromCache<PartCategoryWithHierarchy>(cacheKey)
    if (cached) {
      const normalizedKey = normalizeUrlKey(cached.urlKey, cached.name)
      if (normalizedKey !== cached.urlKey) {
        const next = { ...cached, urlKey: normalizedKey }
        await setCache(cacheKey, next, 3600)
        tg.end(tCache, { hit: true })
        tg.logSummary()
        return next
      }
      tg.end(tCache, { hit: true })
      tg.logSummary()
      return cached
    }
    tg.end(tCache, { hit: false })

    const tFind = tg.start('findTarget')
    const legacyCategoryId = parseIdFromUrlKey(urlKey)
    const normalizedInput = normalizeUrlKey(urlKey, urlKey)

    let targetCategory: (PartCategory & { children: PartCategory[] }) | null = null

    if (legacyCategoryId) {
      const direct = await db.part_categories.findUnique({
        where: { id: legacyCategoryId },
        select: {
          id: true, name: true, name_tr: true, is_active: true,
          has_childs: true, parent_id: true, url_key: true, image: true
        }
      })
      if (direct?.is_active) {
        const children = await db.part_categories.findMany({
          where: { parent_id: direct.id, is_active: true },
          select: {
            id: true, name: true, name_tr: true, is_active: true,
            has_childs: true, parent_id: true, url_key: true, image: true
          }
        })
        targetCategory = {
          id: direct.id,
          name: direct.name,
          nameTr: direct.name_tr,
          isActive: direct.is_active,
          hasChildren: direct.has_childs,
          parentId: direct.parent_id,
          urlKey: normalizeUrlKey(direct.url_key, direct.name),
          image: direct.image,
          children: children.map((c) => ({
            id: c.id,
            name: c.name,
            nameTr: c.name_tr,
            isActive: c.is_active,
            hasChildren: c.has_childs,
            parentId: c.parent_id,
            urlKey: normalizeUrlKey(c.url_key, c.name),
            image: c.image,
            children: []
          }))
        }
      }
    }

    if (!targetCategory) {
      const slugMatches = await db.part_categories.findMany({
        where: { is_active: true, url_key: urlKey },
        select: {
          id: true, name: true, name_tr: true, is_active: true,
          has_childs: true, parent_id: true, url_key: true, image: true
        }
      })

      if (slugMatches.length > 0) {
        const candidatesWithChildren = await Promise.all(
          slugMatches.map(async (cat) => {
            const children = await db.part_categories.findMany({
              where: { parent_id: cat.id, is_active: true },
              select: { id: true }
            })
            return { cat, childCount: children.length }
          })
        )

        candidatesWithChildren.sort((a, b) => {
          const childDiff = b.childCount - a.childCount
          if (childDiff !== 0) return childDiff
          if (a.cat.has_childs !== b.cat.has_childs) return a.cat.has_childs ? -1 : 1
          if ((a.cat.parent_id == null) !== (b.cat.parent_id == null)) return a.cat.parent_id == null ? -1 : 1
          return a.cat.id - b.cat.id
        })

        const best = candidatesWithChildren[0].cat
        const children = await db.part_categories.findMany({
          where: { parent_id: best.id, is_active: true },
          select: {
            id: true, name: true, name_tr: true, is_active: true,
            has_childs: true, parent_id: true, url_key: true, image: true
          }
        })
        targetCategory = {
          id: best.id,
          name: best.name,
          nameTr: best.name_tr,
          isActive: best.is_active,
          hasChildren: best.has_childs,
          parentId: best.parent_id,
          urlKey: normalizeUrlKey(best.url_key, best.name),
          image: best.image,
          children: children.map((c) => ({
            id: c.id,
            name: c.name,
            nameTr: c.name_tr,
            isActive: c.is_active,
            hasChildren: c.has_childs,
            parentId: c.parent_id,
            urlKey: normalizeUrlKey(c.url_key, c.name),
            image: c.image,
            children: []
          }))
        }
      }
    }

    if (!targetCategory) {
      const nameSlugMatches = await db.part_categories.findMany({
        where: { is_active: true, url_key: null },
        select: {
          id: true, name: true, name_tr: true, is_active: true,
          has_childs: true, parent_id: true, url_key: true, image: true
        }
      })

      const matchingByNameSlug = nameSlugMatches.filter(
        (cat) => generateSlug(cat.name) === urlKey || (cat.name_tr && generateSlug(cat.name_tr) === urlKey)
      )

      if (matchingByNameSlug.length > 0) {
        const candidatesWithChildren = await Promise.all(
          matchingByNameSlug.map(async (cat) => {
            const children = await db.part_categories.findMany({
              where: { parent_id: cat.id, is_active: true },
              select: { id: true }
            })
            return { cat, childCount: children.length }
          })
        )

        candidatesWithChildren.sort((a, b) => {
          const childDiff = b.childCount - a.childCount
          if (childDiff !== 0) return childDiff
          if (a.cat.has_childs !== b.cat.has_childs) return a.cat.has_childs ? -1 : 1
          if ((a.cat.parent_id == null) !== (b.cat.parent_id == null)) return a.cat.parent_id == null ? -1 : 1
          return a.cat.id - b.cat.id
        })

        const best = candidatesWithChildren[0].cat
        const children = await db.part_categories.findMany({
          where: { parent_id: best.id, is_active: true },
          select: {
            id: true, name: true, name_tr: true, is_active: true,
            has_childs: true, parent_id: true, url_key: true, image: true
          }
        })
        targetCategory = {
          id: best.id,
          name: best.name,
          nameTr: best.name_tr,
          isActive: best.is_active,
          hasChildren: best.has_childs,
          parentId: best.parent_id,
          urlKey: normalizeUrlKey(best.url_key, best.name),
          image: best.image,
          children: children.map((c) => ({
            id: c.id,
            name: c.name,
            nameTr: c.name_tr,
            isActive: c.is_active,
            hasChildren: c.has_childs,
            parentId: c.parent_id,
            urlKey: normalizeUrlKey(c.url_key, c.name),
            image: c.image,
            children: []
          }))
        }
      }
    }

    if (!targetCategory) {
      tg.end(tFind)
      tg.logSummary()
      return null
    }
    tg.end(tFind)

    const tAncestry = tg.start('ancestry')
    let currentId: number | null = targetCategory.parentId
    const breadcrumbs: { name: string; nameTr: string | null; urlKey: string }[] = []
    while (currentId) {
      const parent = await db.part_categories.findUnique({
        where: { id: currentId },
        select: { id: true, name: true, name_tr: true, url_key: true, is_active: true, parent_id: true }
      })
      if (!parent?.is_active) {
        tg.end(tAncestry)
        tg.logSummary()
        return null
      }
      breadcrumbs.unshift({
        name: parent.name,
        nameTr: parent.name_tr,
        urlKey: normalizeUrlKey(parent.url_key, parent.name)
      })
      currentId = parent.parent_id
    }
    tg.end(tAncestry)

    const tSiblings = tg.start('siblings')
    let siblings: PartCategory[] = []
    if (targetCategory.parentId) {
      const siblingRows = await db.part_categories.findMany({
        where: { parent_id: targetCategory.parentId, is_active: true },
        select: {
          id: true, name: true, name_tr: true, is_active: true,
          has_childs: true, parent_id: true, url_key: true, image: true
        }
      })
      siblings = siblingRows.map((c) => ({
        id: c.id,
        name: c.name,
        nameTr: c.name_tr,
        isActive: c.is_active,
        hasChildren: c.has_childs,
        parentId: c.parent_id,
        urlKey: normalizeUrlKey(c.url_key, c.name),
        image: c.image
      }))
    } else {
      const rootRows = await db.part_categories.findMany({
        where: { parent_id: null, is_active: true },
        select: {
          id: true, name: true, name_tr: true, is_active: true,
          has_childs: true, parent_id: true, url_key: true, image: true
        }
      })
      siblings = rootRows.map((c) => ({
        id: c.id,
        name: c.name,
        nameTr: c.name_tr,
        isActive: c.is_active,
        hasChildren: c.has_childs,
        parentId: c.parent_id,
        urlKey: normalizeUrlKey(c.url_key, c.name),
        image: c.image
      }))
    }
    siblings = sortCategoriesByName(siblings, 'en')
    tg.end(tSiblings)

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

    const tCacheSet = tg.start('cacheSet')
    await setCache(cacheKey, result, 3600)
    tg.end(tCacheSet)

    tg.logSummary()
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
  const tg = createTimerGroup('mainNavCategories')
  const tCache = tg.start('cacheLookup')
  const cacheKey = `main-nav-categories-${locale}-v2`
  const cached = await getFromCache<PartCategory[]>(cacheKey)
  if (cached) {
    tg.end(tCache, { hit: true })
    tg.logSummary()
    return cached
  }
  tg.end(tCache, { hit: false })

  const tDb = tg.start('dbQuery')
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
  tg.end(tDb)
  const tCacheSet = tg.start('cacheSet')
  await setCache(cacheKey, categories, 3600)
  tg.end(tCacheSet)

  tg.logSummary()
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
  const id = parseIdFromUrlKey(urlKey)
  if (id) {
    const exists = await db.part_categories.findUnique({
      where: { id },
      select: { id: true, is_active: true, parent_id: true }
    })
    if (!exists?.is_active) {
      return null
    }

    let currentId: number | null = exists.parent_id
    while (currentId !== null) {
      const parent = await db.part_categories.findUnique({
        where: { id: currentId },
        select: { id: true, is_active: true, parent_id: true }
      })
      if (!parent || !parent.is_active) {
        return null
      }
      currentId = parent.parent_id
    }

    return exists.id
  }

  let matchingCategory = await db.part_categories.findFirst({
    where: {
      is_active: true,
      url_key: urlKey
    },
    select: { id: true, is_active: true, parent_id: true, name: true }
  })

  if (!matchingCategory || !matchingCategory.is_active) {
    const nullUrlKeyCategories = await db.part_categories.findMany({
      where: { is_active: true, url_key: null },
      select: { id: true, is_active: true, parent_id: true, name: true }
    })
    matchingCategory = nullUrlKeyCategories.find(
      (cat) => generateSlug(cat.name) === urlKey
    ) || null
  }

  if (!matchingCategory || !matchingCategory.is_active) {
    return null
  }

  let currentId: number | null = matchingCategory.parent_id
  while (currentId !== null) {
    const parent = await db.part_categories.findUnique({
      where: { id: currentId },
      select: { id: true, is_active: true, parent_id: true }
    })
    if (!parent || !parent.is_active) {
      return null
    }
    currentId = parent.parent_id
  }

  return matchingCategory.id
}
