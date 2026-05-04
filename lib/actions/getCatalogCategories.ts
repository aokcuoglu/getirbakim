import { db } from '@/lib/db'
import { unstable_cache } from 'next/cache'
import { getMainNavCategories } from '@/lib/actions/getPartCategories'

export interface CatalogCategory {
  id: number
  name: string
  urlKey: string
  image: string | null
  parentId: number | null
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

// Generate unique url_key with id suffix
function generateUrlKey(name: string, id: number): string {
  const slug = generateSlug(name)
  return `${slug}-${id}`
}

// Fetch all categories for catalog section (parent tabs + all children)
export interface CatalogData {
  tabs: CatalogCategory[]
  childrenByParent: Record<number, CatalogCategory[]>
}

async function fetchCatalogData(locale: string): Promise<CatalogData> {
  const mainNav = await getMainNavCategories(locale)

  // Get all categories in one query
  const allCategories = await db.part_categories.findMany({
    where: {
      is_active: true
    },
    select: {
      id: true,
      name: true,
      name_tr: true,
      parent_id: true,
      image: true
    },
    orderBy: { name: 'asc' }
  })

  // Helper to get localized name
  const getLocalizedName = (cat: {
    name: string
    name_tr: string | null
  }): string => {
    if (locale === 'tr' && cat.name_tr) {
      return cat.name_tr
    }
    return cat.name
  }

  // Build a map for quick lookup
  const categoryMap = new Map<number, CatalogCategory>()
  const childrenByParent: Record<number, CatalogCategory[]> = {}

  for (const cat of allCategories) {
    const localizedCat: CatalogCategory = {
      id: cat.id,
      name: getLocalizedName(cat),
      urlKey: generateUrlKey(cat.name, cat.id),
      image: cat.image,
      parentId: cat.parent_id
    }
    categoryMap.set(cat.id, localizedCat)

    // Build children map for ALL categories
    if (cat.parent_id !== null) {
      if (!childrenByParent[cat.parent_id]) {
        childrenByParent[cat.parent_id] = []
      }
      childrenByParent[cat.parent_id].push(localizedCat)
    }
  }

  // Tabs: main nav from DB (Car parts + 4 main: Lubrication, Filters, Window Cleaning, Accessories)
  const tabs: CatalogCategory[] = mainNav.map((m) => ({
    id: m.id,
    name: m.name,
    urlKey: m.urlKey || '',
    image: categoryMap.get(m.id)?.image ?? null,
    parentId: null
  }))

  // childrenByParent: only for main nav category ids
  const filteredChildrenByParent: Record<number, CatalogCategory[]> = {}
  for (const m of mainNav) {
    filteredChildrenByParent[m.id] = childrenByParent[m.id] || []
  }

  return { tabs, childrenByParent: filteredChildrenByParent }
}

// Create cached version with locale in cache key
export async function getCatalogData(locale: string = 'en') {
  return unstable_cache(
    () => fetchCatalogData(locale),
    ['catalog-full-data-v5', locale],
    { revalidate: 3600 }
  )()
}
