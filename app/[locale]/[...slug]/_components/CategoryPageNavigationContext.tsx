'use client'

import { createContext, useContext } from 'react'

export interface CategoryPageNavigationContextValue {
  navigate: (href: string) => Promise<void>
  prefetch: (href: string) => Promise<void>
}

export const CategoryPageNavigationContext =
  createContext<CategoryPageNavigationContextValue | null>(null)

export function useCategoryPageNavigationOptional() {
  return useContext(CategoryPageNavigationContext)
}
