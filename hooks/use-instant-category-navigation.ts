'use client'

import { useState, useCallback, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import type {
  PartCategory,
  TrodoCategoryWithHierarchy
} from '@/lib/actions/getPartCategories'
import { buildCategoryUrl as buildCanonicalCategoryUrl } from '@/lib/catalog-url'

/**
 * Hook for instant category navigation (Trodo.com style)
 * 
 * Provides instant UI updates when clicking categories - children appear immediately
 * without waiting for server response. This creates a "single page app" feel.
 */
export function useInstantCategoryNavigation(
  initialCategory: TrodoCategoryWithHierarchy,
  options?: {
    variantSlug?: string
    navigationMode?: 'slug' | 'catalog-query'
    catalogPath?: string
  }
) {
  const router = useRouter()
  const locale = useLocale()
  const variantSlug = options?.variantSlug
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(
    new Set([initialCategory.id]) // Start with current category expanded
  )
  const [activeCategoryId, setActiveCategoryId] = useState<number>(
    initialCategory.id
  )

  useEffect(() => {
    setExpandedCategories(new Set([initialCategory.id]))
    setActiveCategoryId(initialCategory.id)
  }, [initialCategory.id])

  // Build category URL helper
  const buildCategoryUrl = useCallback(
    (urlKey: string) => {
      return buildCanonicalCategoryUrl(locale, {
        categoryUrlKey: urlKey,
        variantSlug
      })
    },
    [locale, variantSlug]
  )

  // Instant category click handler - shows children immediately
  const handleCategoryClick = useCallback(
    (
      category: TrodoCategoryWithHierarchy,
      e?: React.MouseEvent,
      options?: { navigate?: boolean }
    ) => {
      e?.preventDefault()
      const shouldNavigate = options?.navigate ?? true

      // Instant UI update - expand category immediately
      setExpandedCategories((prev) => {
        const next = new Set(prev)
        if (next.has(category.id)) {
          next.delete(category.id) // Toggle: collapse if already expanded
        } else {
          next.add(category.id) // Expand
        }
        return next
      })

      // Set as active
      setActiveCategoryId(category.id)

      // Navigate (non-blocking - UI already updated)
      if (shouldNavigate && category.urlKey) {
        const href = buildCategoryUrl(category.urlKey)
        router.push(href)
      }
    },
    [router, buildCategoryUrl]
  )

  // Check if category is expanded
  const isExpanded = useCallback(
    (categoryId: number) => {
      return expandedCategories.has(categoryId)
    },
    [expandedCategories]
  )

  const markCategoryActive = useCallback((categoryId: number) => {
    setActiveCategoryId(categoryId)
  }, [])

  // Get visible children for a category (instant - no server request)
  const getVisibleChildren = useCallback(
    (category: TrodoCategoryWithHierarchy): PartCategory[] => {
      if (!isExpanded(category.id)) {
        return []
      }
      return category.children || []
    },
    [isExpanded]
  )

  return {
    expandedCategories,
    activeCategoryId,
    handleCategoryClick,
    markCategoryActive,
    isExpanded,
    getVisibleChildren,
    buildCategoryUrl
  }
}
