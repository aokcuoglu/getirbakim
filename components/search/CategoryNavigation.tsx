'use client'

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getLocalizedCategoryName } from '@/lib/utils/category-localization'
import {
  SidebarHeader,
  SidebarSearch,
  SidebarList
} from '@/components/ui/sidebar-primitives'
import type {
  PartCategory,
  TrodoCategoryWithHierarchy
} from '@/lib/actions/getPartCategories'
import { useInstantCategoryNavigation } from '@/hooks/use-instant-category-navigation'
import { buildCategoryUrl as buildCanonicalCategoryUrl } from '@/lib/catalog-url'
import { useCategoryPageNavigationOptional } from '@/app/[locale]/[...slug]/_components/CategoryPageNavigationContext'

interface CategoryNavigationProps {
  category: TrodoCategoryWithHierarchy
  variantSlug?: string
  hideTitle?: boolean
  navigationMode?: 'slug' | 'catalog-query'
  catalogPath?: string
  onNavigate?: () => void
}

interface SearchableCategory {
  id: number
  urlKey: string
  label: string
  pathLabel: string | null
  depth: number
  hasChildren: boolean
}

function scoreSearchResult(item: SearchableCategory, query: string): number {
  const normalizedLabel = item.label.toLowerCase()
  const normalizedPath = item.pathLabel?.toLowerCase() ?? ''

  if (normalizedLabel === query) return 0
  if (normalizedLabel.startsWith(query)) return 1
  if (normalizedLabel.includes(query)) return 2
  if (normalizedPath.startsWith(query)) return 3
  if (normalizedPath.includes(query)) return 4
  return 5
}

function flattenCategoryTree(
  categories: PartCategory[],
  locale: string,
  ancestors: string[] = []
): SearchableCategory[] {
  return categories.flatMap((entry) => {
    const label = getLocalizedCategoryName(entry, locale)
    const pathSegments = ancestors.length > 0 ? [...ancestors, label] : [label]
    const item: SearchableCategory | null = entry.urlKey
      ? {
          id: entry.id,
          urlKey: entry.urlKey,
          label,
          pathLabel:
            ancestors.length > 0 ? [...ancestors, label].join(' / ') : null,
          depth: ancestors.length,
          hasChildren: (entry.children?.length ?? 0) > 0
        }
      : null

    const descendants = flattenCategoryTree(
      entry.children ?? [],
      locale,
      pathSegments
    )

    return item ? [item, ...descendants] : descendants
  })
}

export function CategoryNavigation({
  category,
  variantSlug,
  hideTitle = false,
  navigationMode = 'catalog-query',
  catalogPath = '/catalog',
  onNavigate
}: CategoryNavigationProps) {
  const t = useTranslations('CategoryPage')
  const locale = useLocale()
  const router = useRouter()
  const categoryPageNavigation = useCategoryPageNavigationOptional()
  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const normalizedSearchQuery = deferredSearchQuery.trim().toLowerCase()
  const normalizeHref = useMemo(() => {
    return (rawHref: string) => {
      if (!rawHref) return rawHref
      let href = rawHref

      if (/^https?:\/\//i.test(href)) {
        try {
          const parsed = new URL(href)
          href = `${parsed.pathname}${parsed.search}${parsed.hash}`
        } catch {
          return rawHref
        }
      }

      if (!href.startsWith('/')) return href

      href = href.replace(/^\/(tr|en)(?:\/\1)+(?=\/|$|\?)/, '/$1')

      if (!/^\/(tr|en)(?=\/|$|\?)/.test(href)) {
        href = `/${locale}${href}`
      }

      return href
    }
  }, [locale])

  const {
    isExpanded,
    activeCategoryId,
    handleCategoryClick: instantCategoryClick,
    markCategoryActive,
    buildCategoryUrl
  } = useInstantCategoryNavigation(category, {
    variantSlug,
    navigationMode,
    catalogPath
  })

  const subcategories =
    category.isLeaf && category.siblings?.length
      ? category.siblings
      : category.children || []

  const hasParent = category.breadcrumbs.length > 0
  const parentCategory = hasParent
    ? category.breadcrumbs[category.breadcrumbs.length - 1]
    : null

  const searchableCategories = useMemo(
    () => flattenCategoryTree(subcategories, locale),
    [subcategories, locale]
  )

  const searchResults = useMemo(() => {
    if (!normalizedSearchQuery) return []

    return searchableCategories
      .filter((item) => {
        const haystack = `${item.label} ${item.pathLabel ?? ''}`.toLowerCase()
        return haystack.includes(normalizedSearchQuery)
      })
      .sort((a, b) => {
        const scoreDiff =
          scoreSearchResult(a, normalizedSearchQuery) -
          scoreSearchResult(b, normalizedSearchQuery)
        if (scoreDiff !== 0) return scoreDiff

        if (a.depth !== b.depth) return a.depth - b.depth
        return a.label.localeCompare(b.label, locale)
      })
      .slice(0, 60)
  }, [searchableCategories, normalizedSearchQuery, locale])

  const visibleSubcategories = useMemo(() => {
    if (!normalizedSearchQuery) return subcategories

    const resultIds = new Set(searchResults.map((result) => result.id))
    return subcategories.filter((entry) => resultIds.has(entry.id))
  }, [subcategories, searchResults, normalizedSearchQuery])

  if (subcategories.length === 0 && !parentCategory) {
    return null
  }

  return (
    <div style={{ fontFamily: 'var(--font-heading), sans-serif' }}>
      {parentCategory ? (
        <CategoryNavLink
          href={normalizeHref(buildCategoryUrl(parentCategory.urlKey))}
          isActive={false}
          hasChildren={false}
          router={router}
          alignStart={true}
          className="mb-2.5 min-h-[30px] px-[6px] py-[5px] text-[14px] font-normal text-[#52606d] hover:bg-transparent hover:text-[#212b36]"
        >
          <ChevronLeft size={14} className="shrink-0 text-[#9aa5b1]" />
          <span className="truncate">
            {getLocalizedCategoryName(parentCategory, locale)}
          </span>
        </CategoryNavLink>
      ) : (
        !hideTitle && (
          <SidebarHeader className="mb-3">
            {t('categories')}
          </SidebarHeader>
        )
      )}

      <SidebarSearch
        placeholder={t('searchCategory')}
        value={searchQuery}
        onChange={setSearchQuery}
        className="mb-3"
        inputClassName="h-[38px] rounded-[6px] border-[#c4cdd5] bg-white pl-[35px] pr-[10px] text-[13px] text-[#212b36] placeholder:text-[#7b8794] focus:border-[#98a6b3] focus:ring-[#eef2f5]"
        iconClassName="left-[11px] text-[#7b8794]"
      />

      <SidebarList className="max-h-[min(560px,72vh)] pr-0">
        {normalizedSearchQuery ? (
          searchResults.length > 0 ? (
            searchResults.map((item) => {
              const href = normalizeHref(
                buildCanonicalCategoryUrl(locale, {
                  categoryUrlKey: item.urlKey,
                  variantSlug
                })
              )

              return (
                <CategoryNavLink
                  key={item.id}
                  href={href}
                  isActive={
                    item.id === activeCategoryId || item.urlKey === category.urlKey
                  }
                  hasChildren={item.hasChildren}
                  router={router}
                  onNavigate={onNavigate}
                  onClick={() => markCategoryActive(item.id)}
                  showChevron={false}
                  alignStart={true}
                  className={`min-h-[30px] px-0 py-[5px] text-left text-[14px] font-medium leading-5 transition-colors ${
                    item.id === activeCategoryId || item.urlKey === category.urlKey
                      ? 'text-[#212b36]'
                      : 'text-[#212b36]'
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {item.label}
                  </span>
                </CategoryNavLink>
              )
            })
          ) : (
            <p className="rounded-md bg-white px-3 py-6 text-center text-sm text-slate-500">
              {t('noSubcategories')}
            </p>
          )
        ) : (
          visibleSubcategories
            .filter((sub) => sub.urlKey)
            .map((sub) => {
              const isActive =
                sub.id === activeCategoryId || sub.urlKey === category.urlKey
              const href = normalizeHref(
                buildCanonicalCategoryUrl(locale, {
                  categoryUrlKey: sub.urlKey!,
                  variantSlug
                })
              )
              const hasChildren = (sub.children?.length ?? 0) > 0
              const expanded = isExpanded(sub.id)

              return (
                <div key={sub.id}>
                  <CategoryNavLink
                    href={href}
                    isActive={isActive}
                    hasChildren={hasChildren}
                    router={router}
                    onNavigate={onNavigate}
                    className={`group min-h-[30px] px-0 py-[5px] text-[14px] font-medium leading-5 transition-colors ${
                      isActive
                        ? 'text-[#212b36]'
                        : 'text-[#212b36]'
                    }`}
                    onClick={(e) => {
                      markCategoryActive(sub.id)
                      if (hasChildren) {
                        instantCategoryClick(sub as TrodoCategoryWithHierarchy, e, {
                          navigate: false
                        })
                      }
                    }}
                  >
                    <span className="min-w-0 truncate font-medium">
                      {getLocalizedCategoryName(sub, locale)}
                    </span>
                  </CategoryNavLink>

                  {expanded && hasChildren && sub.children && (
                    <div className="mt-0.5 space-y-0 border-l border-[#e7edf2] pl-4">
                      {sub.children
                        .filter((child) => child.urlKey)
                        .map((child) => {
                          const childHref = normalizeHref(
                            buildCanonicalCategoryUrl(locale, {
                              categoryUrlKey: child.urlKey!,
                              variantSlug
                            })
                          )
                          const childIsActive =
                            child.id === activeCategoryId ||
                            child.urlKey === category.urlKey

                          return (
                            <CategoryNavLink
                              key={child.id}
                              href={childHref}
                              isActive={childIsActive}
                              hasChildren={(child.children?.length ?? 0) > 0}
                              router={router}
                              onNavigate={onNavigate}
                              className={`min-h-7 px-0 py-0.5 text-[13px] font-medium leading-6 transition-colors ${
                                childIsActive
                                  ? 'text-[#212b36]'
                                  : 'text-[#52606d]'
                              }`}
                              onClick={(e) => {
                                markCategoryActive(child.id)
                                if ((child.children?.length ?? 0) > 0) {
                                  instantCategoryClick(
                                    child as TrodoCategoryWithHierarchy,
                                    e,
                                    { navigate: false }
                                  )
                                }
                              }}
                            >
                              <span className="min-w-0 truncate">
                                {getLocalizedCategoryName(child, locale)}
                              </span>
                            </CategoryNavLink>
                          )
                        })}
                    </div>
                  )}
                </div>
              )
            })
        )}
      </SidebarList>
    </div>
  )
}

function CategoryNavLink({
  href,
  isActive,
  hasChildren,
  showChevron = true,
  alignStart = false,
  children,
  router,
  onNavigate,
  className,
  onClick
}: {
  href: string
  isActive: boolean
  hasChildren: boolean
  showChevron?: boolean
  alignStart?: boolean
  children: React.ReactNode
  router: ReturnType<typeof useRouter>
  onNavigate?: () => void
  className?: string
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void
}) {
  const prefetchedRef = useRef(false)
  const categoryPageNavigation = useCategoryPageNavigationOptional()
  const normalizedHref = href.replace(
    /^\/(tr|en)(?:\/\1)+(?=\/|$|\?)/,
    '/$1'
  )

  const prefetchLink = useCallback(() => {
    if (!prefetchedRef.current && normalizedHref && !isActive) {
      router.prefetch(normalizedHref)
      void categoryPageNavigation?.prefetch(normalizedHref)
      prefetchedRef.current = true
    }
  }, [normalizedHref, isActive, router, categoryPageNavigation])

  useEffect(() => {
    prefetchedRef.current = false
  }, [normalizedHref])

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)

    if (!isActive) {
      e.preventDefault()
      onNavigate?.()
      if (categoryPageNavigation) {
        void categoryPageNavigation.navigate(normalizedHref)
      } else {
        router.push(normalizedHref)
      }
    }
  }

  return (
    <a
      href={normalizedHref}
      onClick={handleClick}
      onMouseEnter={prefetchLink}
      onTouchStart={prefetchLink}
      className={
        `flex w-full cursor-pointer items-center ${alignStart ? 'justify-start' : 'justify-between'} gap-2 rounded-[4px] transition-colors hover:bg-[#f8f9f9] ${className || `px-0 py-[5px] text-[14px] text-[#212b36]`}`
      }
    >
      {children}
      {!isActive && hasChildren && showChevron && (
        <ChevronRight
          size={12}
          className="shrink-0 text-[#9aa5b1]"
          strokeWidth={1.75}
        />
      )}
    </a>
  )
}
