import type { Metadata } from 'next'
import { LegalDocumentPage } from '@/components/legal/LegalDocumentPage'
import { getLegalMetadata, getLegalPageData } from '../_lib/legal-page'

interface LegalPageProps {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: LegalPageProps): Promise<Metadata> {
  return getLegalMetadata(params, 'deliveryAndReturns')
}

export default async function DeliveryAndReturnsPage({ params }: LegalPageProps) {
  const { locale, document } = await getLegalPageData(params, 'deliveryAndReturns')
  return <LegalDocumentPage locale={locale} document={document} />
}
