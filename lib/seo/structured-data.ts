import { buildAbsoluteUrl, normalizeLocale, withLocalePath } from '@/lib/seo/url'
import type { TrodoCategoryWithHierarchy } from '@/lib/actions/getPartCategories'
import { getLocalizedCategoryName } from '@/lib/utils/category-localization'

export function buildOrganizationJsonLd() {
  const url = buildAbsoluteUrl('/')
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'GetirBakim',
    url,
    logo: buildAbsoluteUrl('/icon.svg'),
    sameAs: []
  }
}

export function buildWebSiteJsonLd(locale: string) {
  const safeLocale = normalizeLocale(locale)
  const basePath = withLocalePath(safeLocale, '/')
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'GetirBakim',
    url: buildAbsoluteUrl(basePath),
    inLanguage: safeLocale,
    potentialAction: {
      '@type': 'SearchAction',
      target: buildAbsoluteUrl(withLocalePath(safeLocale, '/search?q={search_term_string}')),
      'query-input': 'required name=search_term_string'
    }
  }
}

export function buildCategoryBreadcrumbJsonLd(
  locale: string,
  category: TrodoCategoryWithHierarchy
) {
  const safeLocale = normalizeLocale(locale)
  const baseItems = [
    {
      '@type': 'ListItem',
      position: 1,
      name: safeLocale === 'tr' ? 'Ana Sayfa' : 'Home',
      item: buildAbsoluteUrl(withLocalePath(safeLocale, '/'))
    }
  ]

  const breadcrumbItems = category.breadcrumbs.map((crumb, index) => ({
    '@type': 'ListItem',
    position: index + 2,
    name: getLocalizedCategoryName(crumb, safeLocale),
    item: buildAbsoluteUrl(
      withLocalePath(safeLocale, `/${crumb.urlKey || 'car-parts'}`)
    )
  }))

  const currentItem = {
    '@type': 'ListItem',
    position: breadcrumbItems.length + 2,
    name: getLocalizedCategoryName(category, safeLocale),
    item: buildAbsoluteUrl(
      withLocalePath(safeLocale, `/${category.urlKey || 'car-parts'}`)
    )
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [...baseItems, ...breadcrumbItems, currentItem]
  }
}

export function buildCategoryItemListJsonLd(
  locale: string,
  category: TrodoCategoryWithHierarchy
) {
  const safeLocale = normalizeLocale(locale)
  const children = (category.children || [])
    .filter((item) => Boolean(item.urlKey))
    .slice(0, 100)

  if (children.length === 0) {
    return null
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: getLocalizedCategoryName(category, safeLocale),
    itemListElement: children.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: getLocalizedCategoryName(item, safeLocale),
      url: buildAbsoluteUrl(withLocalePath(safeLocale, `/${item.urlKey}`))
    }))
  }
}
