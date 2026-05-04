import type { Metadata } from 'next'
import { getLegalDocument, resolveLegalLocale } from '@/lib/legal/content'
import type { LegalDocument, LegalLocale, LegalPageKey } from '@/lib/legal/types'
import { buildLocaleAlternates, defaultRobotsIndexing } from '@/lib/seo/url'

export async function getLegalPageData(
  params: Promise<{ locale: string }>,
  key: LegalPageKey
): Promise<{ locale: LegalLocale; document: LegalDocument }> {
  const { locale } = await params
  const resolvedLocale = resolveLegalLocale(locale)

  return {
    locale: resolvedLocale,
    document: getLegalDocument(resolvedLocale, key)
  }
}

export async function getLegalMetadata(
  params: Promise<{ locale: string }>,
  key: LegalPageKey
): Promise<Metadata> {
  const { locale } = await params
  const resolvedLocale = resolveLegalLocale(locale)
  const document = getLegalDocument(resolvedLocale, key)

  return {
    title: `${document.title} | GetirBakim`,
    description: document.summary,
    alternates: buildLocaleAlternates(locale, `/${document.slug}`),
    robots: defaultRobotsIndexing()
  }
}
