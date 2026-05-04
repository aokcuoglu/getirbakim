import type { Metadata } from 'next'
import { LegalDocumentPage } from '@/components/legal/LegalDocumentPage'
import { getLegalMetadata, getLegalPageData } from '../_lib/legal-page'

interface LegalPageProps {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: LegalPageProps): Promise<Metadata> {
  return getLegalMetadata(params, 'privacyPolicy')
}

export default async function PrivacyPolicyPage({ params }: LegalPageProps) {
  const { locale, document } = await getLegalPageData(params, 'privacyPolicy')
  return <LegalDocumentPage locale={locale} document={document} />
}
