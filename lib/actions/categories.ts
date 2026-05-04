'use server'

import { db } from '@/lib/db'

export type Category = {
  id: number
  name: string
  slug: string
  image: string | null
  children?: Category[]
}

export type CategoryWithParent = Category & {
  parent?: {
    id: number
    name: string
    slug: string
  } | null
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

/**
 * Fetches all categories from part_categories table
 */
export async function getCategories(): Promise<Category[]> {
  // Fetch all categories
  const allCategories = await db.part_categories.findMany({
    where: {
      is_active: true
    },
    orderBy: { name: 'asc' }
  })

  // Reconstruct tree
  const categoryMap = new Map<number, Category & { parentId: number | null }>()

  // First pass: Create nodes
  allCategories.forEach((cat) => {
    categoryMap.set(cat.id, {
      id: cat.id,
      name: cat.name,
      slug: generateUrlKey(cat.name, cat.id),
      image: null,
      parentId: cat.parent_id,
      children: []
    })
  })

  const rootCategories: Category[] = []

  // Second pass: Link children
  categoryMap.forEach((cat) => {
    if (cat.parentId) {
      const parent = categoryMap.get(cat.parentId)
      if (parent) {
        parent.children?.push(cat)
      }
    } else {
      rootCategories.push(cat)
    }
  })

  return rootCategories
}

// Category with full tree structure for client-side caching
export type CategoryNode = {
  id: number
  name: string
  slug: string
  image: string | null
  parentId: number | null
  parentSlug: string | null
  parentName: string | null
  children: CategoryNode[]
}

export type CategoryTreeData = {
  tree: CategoryNode[]
  flatMap: Map<string, CategoryNode>
}

/**
 * Fetches all categories with complete tree structure.
 * Used for client-side caching to enable instant navigation.
 */
export async function getCategoriesWithFullTree(): Promise<CategoryNode[]> {
  // Fetch all categories in one query
  const allCategories = await db.part_categories.findMany({
    where: {
      is_active: true
    },
    orderBy: { name: 'asc' }
  })

  // Build lookup maps
  const categoryMap = new Map<number, CategoryNode>()
  const slugToCategory = new Map<string, CategoryNode>()

  // First pass: Create all nodes
  allCategories.forEach((cat) => {
    const slug = generateUrlKey(cat.name, cat.id)
    const node: CategoryNode = {
      id: cat.id,
      name: cat.name,
      slug,
      image: null,
      parentId: cat.parent_id,
      parentSlug: null,
      parentName: null,
      children: []
    }
    categoryMap.set(cat.id, node)
    slugToCategory.set(slug, node)
  })

  // Second pass: Link children and set parent info
  const rootCategories: CategoryNode[] = []

  categoryMap.forEach((node) => {
    if (node.parentId) {
      const parent = categoryMap.get(node.parentId)
      if (parent) {
        node.parentSlug = parent.slug
        node.parentName = parent.name
        parent.children.push(node)
      }
    } else {
      rootCategories.push(node)
    }
  })

  return rootCategories
}

export async function getCategoryBySlugWithChildren(
  slug: string
): Promise<CategoryWithParent | null> {
  // Parse id from slug: "air-filter-100384" -> 100384
  const match = slug.match(/-(\d+)$/)
  if (!match) return null

  const categoryId = parseInt(match[1], 10)

  // First, get the category by id
  const category = await db.part_categories.findUnique({
    where: { id: categoryId }
  })

  if (!category?.is_active) {
    return null
  }

  // Get parent if exists
  let parent = null
  if (category.parent_id) {
    const parentCat = await db.part_categories.findUnique({
      where: { id: category.parent_id }
    })
    if (!parentCat?.is_active) {
      return null
    }

    parent = {
      id: parentCat.id,
      name: parentCat.name,
      slug: generateUrlKey(parentCat.name, parentCat.id)
    }
  }

  // Get children
  const childCategories = await db.part_categories.findMany({
    where: { parent_id: category.id, is_active: true },
    orderBy: { name: 'asc' }
  })

  const children: Category[] = childCategories.map((child) => ({
    id: child.id,
    name: child.name,
    slug: generateUrlKey(child.name, child.id),
    image: null
  }))

  return {
    id: category.id,
    name: category.name,
    slug: generateUrlKey(category.name, category.id),
    image: null,
    parent,
    children
  }
}
