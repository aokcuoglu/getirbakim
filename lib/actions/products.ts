'use server'

import { Product } from '@/types'

export async function getFilteredProducts(
  categoryId?: string,
  minPrice?: number,
  maxPrice?: number
): Promise<Product[]> {
  // TODO: Re-implement product fetching using the new schema (e.g., 'parts' table).
  // The 'filters' and 'manufacturers' tables have been removed.
  console.warn(
    '[getFilteredProducts] returning empty array as tables are removed.'
  )
  return []
}
