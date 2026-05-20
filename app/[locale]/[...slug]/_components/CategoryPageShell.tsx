'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition
} from 'react'
import { getLocalizedCategoryName } from '@/lib/utils/category-localization'
import { CategoryClientWrapper } from './CategoryClientWrapper'
import { CategorySidebar } from './CategorySidebar'
import { CategoryContent } from './CategoryContent'
import { CategorySeoContent } from './CategorySeoContent'
import { CategoryPopularitySections } from './CategoryPopularitySections'
import { BreadcrumbSection } from './BreadcrumbSection'
import type { CategoryPagePayload } from '../../_lib/category-page-data'
import type { CategoryShellPayload } from '../../_lib/category-page-data'
import { CategoryPageNavigationContext } from './CategoryPageNavigationContext'

function normalizeHref(href: string) {
  const parsed = new URL(href, window.location.origin)
  return `${parsed.pathname}${parsed.search}`
}

function isCategoryPathForLocale(href: string, locale: string) {
  const parsed = new URL(href, window.location.origin)
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments[0] !== locale) {
    return false
  }

  const slug = segments[1]
  if (!slug) return false

  if (slug === 'catalog') {
    return parsed.searchParams.has('cat')
  }

  return true
}

export function CategoryPageShell({
  shellPayload
}: {
  shellPayload: CategoryShellPayload
}) {
  const [payload, setPayload] = useState<CategoryPagePayload>({
    locale: shellPayload.locale,
    url: shellPayload.url,
    category: shellPayload.category,
    variantSlug: shellPayload.variantSlug,
    resolvedVehicleId: shellPayload.resolvedVehicleId,
    vehicleResolutionFailed: shellPayload.vehicleResolutionFailed,
    popularManufacturers: shellPayload.popularManufacturers
  })
  const [, startTransition] = useTransition()
  const cacheRef = useRef<Map<string, CategoryPagePayload>>(
    new Map([[shellPayload.url, payload]])
  )
  const inflightRef = useRef<Map<string, Promise<CategoryPagePayload>>>(
    new Map()
  )

  const fetchPayload = useCallback(async (href: string) => {
    const normalizedHref = normalizeHref(href)

    const cached = cacheRef.current.get(normalizedHref)
    if (cached) {
      return cached
    }

    const existing = inflightRef.current.get(normalizedHref)
    if (existing) {
      return existing
    }

    const endpoint = `/api/category-page?href=${encodeURIComponent(normalizedHref)}`
    const t0 = performance.now()

    const request = fetch(endpoint, {
      credentials: 'same-origin'
    })
      .then(async (response) => {
        const durationMs = Number((performance.now() - t0).toFixed(1))
        if (!response.ok) {
          console.error(
            `[category-page] endpoint=${endpoint} durationMs=${durationMs} status=${response.status} source=error`
          )
          throw new Error(`Failed to fetch category page payload (${response.status})`)
        }

        console.log(
          `[category-page] endpoint=/api/category-page href=${normalizedHref} durationMs=${durationMs} status=${response.status} source=success`
        )
        return (await response.json()) as CategoryPagePayload
      })
      .then((nextPayload) => {
        cacheRef.current.set(normalizedHref, nextPayload)
        return nextPayload
      })
      .catch((error) => {
        const durationMs = Number((performance.now() - t0).toFixed(1))
        console.error(
          `[category-page] endpoint=${endpoint} durationMs=${durationMs} source=fetch-error error=${error instanceof Error ? error.message : String(error)}`
        )
        throw error
      })
      .finally(() => {
        inflightRef.current.delete(normalizedHref)
      })

    inflightRef.current.set(normalizedHref, request)
    return request
  }, [])

  const prefetch = useCallback(
    async (href: string) => {
      if (!isCategoryPathForLocale(href, payload.locale)) return

      try {
        await fetchPayload(href)
      } catch (error) {
        console.error('Category prefetch failed:', error)
      }
    },
    [fetchPayload, payload.locale]
  )

  const navigate = useCallback(
    async (href: string) => {
      if (!isCategoryPathForLocale(href, payload.locale)) {
        window.location.assign(href)
        return
      }

      const nextPayload = await fetchPayload(href)

      startTransition(() => {
        setPayload(nextPayload)
      })

      const normalizedHref = normalizeHref(href)
      if (normalizedHref !== `${window.location.pathname}${window.location.search}`) {
        window.history.pushState({ categoryShell: true }, '', normalizedHref)
      }
    },
    [fetchPayload, payload.locale]
  )

  useEffect(() => {
    const handlePopState = () => {
      const href = `${window.location.pathname}${window.location.search}`

      if (!isCategoryPathForLocale(href, payload.locale)) {
        window.location.reload()
        return
      }

      void fetchPayload(href)
        .then((nextPayload) => {
          startTransition(() => {
            setPayload(nextPayload)
          })
        })
        .catch((error) => {
          console.error('Category popstate sync failed:', error)
          window.location.reload()
        })
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [fetchPayload, payload.locale])

  const navigationValue = useMemo(
    () => ({
      navigate,
      prefetch
    }),
    [navigate, prefetch]
  )

  return (
    <CategoryPageNavigationContext.Provider value={navigationValue}>
      <BreadcrumbSection
        category={payload.category}
        variantSlug={payload.variantSlug}
        showIntro={!payload.category.isLeaf}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-8">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <h1 className="text-xl font-semibold text-slate-900">
            {getLocalizedCategoryName(payload.category, payload.locale)}
          </h1>
        </div>

        {payload.category.isLeaf ? (
          <CategoryClientWrapper
            key={payload.url}
            category={payload.category}
            variantSlug={payload.variantSlug}
            resolvedVehicleId={payload.resolvedVehicleId}
            vehicleResolutionFailed={payload.vehicleResolutionFailed}
          />
        ) : (
          <div
            key={payload.url}
            className="flex flex-col gap-5 lg:flex-row xl:gap-6"
          >
            <CategorySidebar
              category={payload.category}
              variantSlug={payload.variantSlug}
            />
            <CategoryContent
              category={payload.category}
              variantSlug={payload.variantSlug}
            />
          </div>
        )}
      </div>

      {!payload.category.isLeaf && (
        <>
          <CategoryPopularitySections
            manufacturers={payload.popularManufacturers}
          />
          <CategorySeoContent
            categoryName={getLocalizedCategoryName(payload.category, payload.locale)}
          />
        </>
      )}
    </CategoryPageNavigationContext.Provider>
  )
}