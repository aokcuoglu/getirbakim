/**
 * Categories API client
 */

import { apiRequest, ApiClientError } from './client'

export { ApiClientError }

export interface Subcategory {
  id: string
  name: string
  nameTr?: string | null
  slug: string
  active: boolean
  productCount: number
}

export interface Category {
  id: string
  name: string
  nameTr?: string | null
  slug: string
  active: boolean
  parentId: string | null
  parent?: {
    id: string
    name: string
    nameTr?: string | null
    slug: string
  } | null
  children: Subcategory[]
  productCount: number
  subcategoryCount: number
}

/**
 * Fetch all categories with their subcategories
 */
export async function getCategories(): Promise<Category[]> {
  return apiRequest<Category[]>('/api/admin/categories')
}

/**
 * Create a new category or subcategory
 */
export async function createCategory(data: {
  name: string
  slug: string
  parentId?: string | null
  active?: boolean
}): Promise<Category> {
  return apiRequest<Category>('/api/admin/categories', {
    method: 'POST',
    body: JSON.stringify(data)
  })
}

/**
 * Update a category or subcategory
 */
export async function updateCategory(
  id: string,
  data: {
    name: string
    slug?: string
    parentId?: string | null
    active?: boolean
  }
): Promise<Category> {
  return apiRequest<Category>(`/api/admin/categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  })
}

/**
 * Toggle category active status
 */
export async function toggleCategoryActive(
  id: string,
  active: boolean
): Promise<Category> {
  return apiRequest<Category>(`/api/admin/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ active })
  })
}

/**
 * Delete a category or subcategory
 */
export async function deleteCategory(id: string): Promise<void> {
  await apiRequest<{ message: string }>(`/api/admin/categories/${id}`, {
    method: 'DELETE'
  })
}

/**
 * Generate URL-friendly slug from name
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}
