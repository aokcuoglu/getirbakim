import type { Metadata } from 'next'
import { LegalDocumentPage } from '@/components/legal/LegalDocumentPage'
import { getLegalMetadata, getLegalPageData } from '../_lib/legal-page'

interface LegalPageProps {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: LegalPageProps): Promise<Metadata> {
  return getLegalMetadata(params, 'cookiePolicy')
}

export default async function CookiePolicyPage({ params }: LegalPageProps) {
  const { locale, document } = await getLegalPageData(params, 'cookiePolicy')
  return <LegalDocumentPage locale={locale} document={document} />
}
