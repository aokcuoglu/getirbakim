/**
 * Categories Server API - Direct database access for server components
 */

import { db } from '@/lib/db'
import type { Category } from '@/lib/api/categories'

async function executeWithRetry<T>(
  operation: () => Promise<T>,
  retries: number = 3
): Promise<T> {
  let attempt = 0
  let lastError: unknown = null

  while (attempt < retries) {
    try {
      return await operation()
    } catch (error) {
      attempt += 1
      lastError = error
      if (attempt >= retries) {
        throw error
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Operation failed after retries')
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
 * Fetch all categories directly from database (for server components)
 */
export async function getCategoriesFromDB(
  _bypassCache: boolean = false
): Promise<Category[]> {
  // Fetch all categories
  const allCategories = await executeWithRetry(
    () =>
      db.part_categories.findMany({
        where: {
          is_active: true
        },
        orderBy: { name: 'asc' }
      }),
    3
  )

  // Separate root categories and subcategories
  const parentCategories = allCategories.filter((cat) => cat.parent_id === null)
  const allSubcategories = allCategories.filter((cat) => cat.parent_id !== null)

  // Get product counts per category
  const productCounts = await executeWithRetry(async () => {
    const counts: { categoryId: number; count: number }[] = []

    for (const cat of allCategories) {
      const count = await db.parts.count({
        where: { category_id: cat.id }
      })
      counts.push({ categoryId: cat.id, count })
    }

    return counts
  }, 3)

  const countMap = new Map(
    productCounts.map((pc) => [pc.categoryId, pc.count])
  )

  return parentCategories.map((cat) => {
    const subcategories = allSubcategories.filter(
      (sub) => sub.parent_id === cat.id
    )

    return {
      id: cat.id.toString(),
      name: cat.name,
      nameTr: cat.name_tr,
      slug: generateUrlKey(cat.name, cat.id),
      active: cat.is_active,
      parentId: null,
      children: subcategories.map((sub) => ({
        id: sub.id.toString(),
        name: sub.name,
        nameTr: sub.name_tr || null,
        slug: generateUrlKey(sub.name, sub.id),
        active: sub.is_active,
        productCount: countMap.get(sub.id) || 0
      })),
      productCount: subcategories.reduce(
        (sum, sub) => sum + (countMap.get(sub.id) || 0),
        0
      ),
      subcategoryCount: subcategories.length
    }
  })
}
