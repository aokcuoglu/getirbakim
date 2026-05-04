'use server'

import { getMainNavCategories } from '@/lib/actions/getPartCategories'
import type { PartCategory } from '@/lib/actions/getPartCategories'

/** Main category from DB (Car parts + 4 main) */
export interface TopCategory {
  id: number
  slug: string
  label: string
  labelTr: string | null
  image: string | null
  children: TopCategory[]
}

function toTopCategory(c: PartCategory): TopCategory {
  return {
    id: c.id,
    slug: c.urlKey || '',
    label: c.name,
    labelTr: c.nameTr,
    image: null,
    children: []
  }
}

// Get a main category by slug (urlKey)
export async function getTopCategory(
  slug: string
): Promise<TopCategory | null> {
  const list = await getMainNavCategories('en')
  const c = list.find((x) => x.urlKey === slug)
  return c ? toTopCategory(c) : null
}

// Subcategories: use getPartCategories / getCategoryByUrlKey for DB tree
export async function getSubcategories(
  _parentSlug: string
): Promise<TopCategory[]> {
  return []
}

// All main category slugs (urlKeys) for static generation
export async function getAllTopCategorySlugs(): Promise<string[]> {
  const list = await getMainNavCategories('en')
  return list.map((c) => c.urlKey || '')
}

// All main categories from DB (Car parts + Lubrication, Filters, Window Cleaning, Accessories)
export async function getAllTopCategories(
  locale: string = 'en'
): Promise<TopCategory[]> {
  const list = await getMainNavCategories(locale)
  return list.map(toTopCategory)
}
