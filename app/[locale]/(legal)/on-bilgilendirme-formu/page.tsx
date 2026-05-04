import type { Metadata } from 'next'
import { LegalDocumentPage } from '@/components/legal/LegalDocumentPage'
import { getLegalMetadata, getLegalPageData } from '../_lib/legal-page'

interface LegalPageProps {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: LegalPageProps): Promise<Metadata> {
  return getLegalMetadata(params, 'preInformation')
}

export default async function PreInformationPage({ params }: LegalPageProps) {
  const { locale, document } = await getLegalPageData(params, 'preInformation')
  return <LegalDocumentPage locale={locale} document={document} />
}
