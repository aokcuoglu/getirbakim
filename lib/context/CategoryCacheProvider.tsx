'use client'

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  ReactNode
} from 'react'
import { useRouter } from 'next/navigation'
import { CategoryNode } from '@/lib/actions/categories'
import { useLocale } from 'next-intl'
import { buildCatalogUrl } from '@/lib/catalog-url'

interface CategoryCacheContextType {
  // Full category tree
  categories: CategoryNode[]
  // Get category by slug (O(1) lookup)
  getCategoryBySlug: (slug: string) => CategoryNode | null
  // Current active category (for instant UI updates)
  activeCategory: CategoryNode | null
  // Navigate to category with instant UI update
  navigateToCategory: (slug: string) => void
  // Reset to root (clear active category)
  resetToRoot: () => void
  // Check if cache is ready
  isLoaded: boolean
}

const CategoryCacheContext = createContext<CategoryCacheContextType | null>(
  null
)

interface CategoryCacheProviderProps {
  children: ReactNode
  initialCategories: CategoryNode[]
}

export function CategoryCacheProvider({
  children,
  initialCategories
}: CategoryCacheProviderProps) {
  const router = useRouter()
  const locale = useLocale()
  const [activeCategory, setActiveCategory] = useState<CategoryNode | null>(
    null
  )

  // Build flat slug map for O(1) lookups
  const slugMap = useMemo(() => {
    const map = new Map<string, CategoryNode>()

    function addToMap(categories: CategoryNode[]) {
      categories.forEach((cat) => {
        map.set(cat.slug, cat)
        if (cat.children.length > 0) {
          addToMap(cat.children)
        }
      })
    }

    addToMap(initialCategories)
    return map
  }, [initialCategories])

  // Get category by slug - O(1)
  const getCategoryBySlug = useCallback(
    (slug: string): CategoryNode | null => {
      return slugMap.get(slug) || null
    },
    [slugMap]
  )

  // Navigate with instant UI update
  const navigateToCategory = useCallback(
    (slug: string) => {
      const category = slugMap.get(slug)
      if (category) {
        // Instantly update UI
        setActiveCategory(category)
        // Update URL (this triggers Next.js navigation but UI is already updated)
        router.push(
          buildCatalogUrl(locale, {
            categoryUrlKey: slug
          })
        )
      }
    },
    [slugMap, router, locale]
  )

  // Reset to root (clear active category and go to car-parts)
  const resetToRoot = useCallback(() => {
    setActiveCategory(null)
    router.push(
      buildCatalogUrl(locale, {
        categoryUrlKey: 'car-parts'
      })
    )
  }, [router, locale])

  const value = useMemo(
    () => ({
      categories: initialCategories,
      getCategoryBySlug,
      activeCategory,
      navigateToCategory,
      resetToRoot,
      isLoaded: true
    }),
    [
      initialCategories,
      getCategoryBySlug,
      activeCategory,
      navigateToCategory,
      resetToRoot
    ]
  )

  return (
    <CategoryCacheContext.Provider value={value}>
      {children}
    </CategoryCacheContext.Provider>
  )
}

export function useCategoryCache() {
  const context = useContext(CategoryCacheContext)
  if (!context) {
    throw new Error(
      'useCategoryCache must be used within a CategoryCacheProvider'
    )
  }
  return context
}

// Optional hook that doesn't throw - useful for components that may be outside provider
export function useCategoryCacheOptional() {
  return useContext(CategoryCacheContext)
}
