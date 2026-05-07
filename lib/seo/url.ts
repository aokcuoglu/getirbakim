import type { Metadata } from 'next'
import { resolveSiteUrl } from '@/lib/site-url'

export type SupportedLocale = 'en' | 'tr'

const DEFAULT_LOCALE: SupportedLocale = 'tr'

export function normalizeLocale(locale: string): SupportedLocale {
  return locale === 'tr' ? 'tr' : 'en'
}

function splitPathQueryHash(input: string): {
  pathname: string
  query: string
  hash: string
} {
  const [pathAndQuery, hash = ''] = input.split('#', 2)
  const [pathname = '', query = ''] = pathAndQuery.split('?', 2)
  return { pathname, query, hash }
}

function ensureLeadingSlash(pathname: string): string {
  if (!pathname) return '/'
  return pathname.startsWith('/') ? pathname : `/${pathname}`
}

function stripLocalePrefix(pathname: string): string {
  const normalized = ensureLeadingSlash(pathname)
  return normalized.replace(/^\/(en|tr)(?=\/|$)/, '') || '/'
}

export function withLocalePath(locale: string, path: string): string {
  const safeLocale = normalizeLocale(locale)
  const { pathname, query, hash } = splitPathQueryHash(path)
  const strippedPath = stripLocalePrefix(pathname)
  const cleanPath = strippedPath === '/' ? '' : strippedPath
  const localized = `/${safeLocale}${cleanPath}`
  const withQuery = query ? `${localized}?${query}` : localized
  return hash ? `${withQuery}#${hash}` : withQuery
}

export function buildAbsoluteUrl(path: string): string {
  const baseUrl = resolveSiteUrl().replace(/\/$/, '')
  const normalizedPath = ensureLeadingSlash(path)
  return `${baseUrl}${normalizedPath}`
}

export function buildLocaleAlternates(
  locale: string,
  pathWithoutLocale: string
): NonNullable<Metadata['alternates']> {
  const canonicalPath = withLocalePath(locale, pathWithoutLocale)
  const enPath = withLocalePath('en', pathWithoutLocale)
  const trPath = withLocalePath('tr', pathWithoutLocale)

  return {
    canonical: canonicalPath,
    languages: {
      tr: trPath,
      en: enPath,
      'x-default': trPath
    }
  }
}

export function defaultRobotsIndexing(): NonNullable<Metadata['robots']> {
  const allowed = process.env.NEXT_PUBLIC_ALLOW_INDEXING?.trim().toLowerCase() === 'true'

  return {
    index: allowed,
    follow: allowed
  }
}

export function defaultLocaleForAlternates(): SupportedLocale {
  return DEFAULT_LOCALE
}
