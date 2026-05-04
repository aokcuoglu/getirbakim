/**
 * Products API client
 */

import { apiRequest, ApiClientError } from './client'

export { ApiClientError }

export interface Product {
  id: string
  partNumber: string
  partNumberNormalized?: string
  name: string
  brand?: string
  imageUrl?: string | null
  slug: string
  description?: string
  active: boolean
  createdAt: string
  category?: {
    id: string
    name: string
    nameTr?: string | null
  }
  variants: ProductVariant[]
  pricingInventory?: {
    sellingPrice?: number | null
    currency?: string
    stockQuantity?: number
    reservedStock?: number
    minStockLevel?: number
  }
}

export interface ProductVariant {
  id: string
  name: string
  sku?: string
  price?: number
}

export interface ProductsResponse {
  products: Product[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
}

export interface GetProductsParams {
  page?: number
  limit?: number
  search?: string
  categoryId?: string
  subcategoryId?: string
  brand?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  _t?: number // Cache busting
}

/**
 * Fetch products with pagination and filters
 */
export async function getProducts(
  params: GetProductsParams = {}
): Promise<ProductsResponse> {
  const searchParams = new URLSearchParams()

  if (params.page) searchParams.set('page', params.page.toString())
  if (params.limit) searchParams.set('limit', params.limit.toString())
  if (params.search) searchParams.set('search', params.search)
  if (params.categoryId) searchParams.set('categoryId', params.categoryId)
  if (params.subcategoryId)
    searchParams.set('subcategoryId', params.subcategoryId)
  if (params.brand) searchParams.set('brand', params.brand)
  if (params.sortBy) searchParams.set('sortBy', params.sortBy)
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder)
  if (params._t) searchParams.set('_t', params._t.toString())

  const queryString = searchParams.toString()
  const url = `/api/admin/products${queryString ? `?${queryString}` : ''}`

  return apiRequest<ProductsResponse>(url)
}

/**
 * Fetch unique brands, optionally filtered by subcategory
 */
export async function getBrands(subcategoryId?: string): Promise<string[]> {
  const url = subcategoryId
    ? `/api/admin/products/brands?subcategoryId=${subcategoryId}`
    : '/api/admin/products/brands'

  return apiRequest<string[]>(url)
}

/**
 * Delete a product by ID
 */
export async function deleteProduct(id: string): Promise<void> {
  await apiRequest<{ success: boolean; message: string }>(
    `/api/admin/products/${id}`,
    {
      method: 'DELETE'
    }
  )
}

/**
 * Get a single product by ID
 */
export async function getProduct(id: string): Promise<Product> {
  return apiRequest<Product>(`/api/admin/products/${id}`)
}

/**
 * Create a new product
 */
export async function createProduct(
  data: Partial<Product>
): Promise<{ success: boolean; product: Product }> {
  return apiRequest<{ success: boolean; product: Product }>(
    '/api/admin/products',
    {
      method: 'POST',
      body: JSON.stringify(data)
    }
  )
}

/**
 * Update an existing product
 */
export async function updateProduct(
  id: string,
  data: Partial<Product>
): Promise<{ success: boolean; product: Product }> {
  return apiRequest<{ success: boolean; product: Product }>(
    `/api/admin/products/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(data)
    }
  )
}
