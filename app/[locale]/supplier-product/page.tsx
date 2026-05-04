import { notFound, redirect } from 'next/navigation'
import { resolveSupplierProductPartIdByLookup } from '@/lib/actions/getSupplierProductById'

interface SupplierProductLookupPageProps {
  params: Promise<{
    locale: string
  }>
  searchParams: Promise<{
    provider?: string
    sku?: string
  }>
}

export const dynamic = 'force-dynamic'

export default async function SupplierProductLookupPage({
  params,
  searchParams
}: SupplierProductLookupPageProps) {
  const { locale } = await params
  const { provider: providerParam, sku } = await searchParams

  const providerCode = providerParam?.trim() || ''
  const supplierSku = sku?.trim() || ''

  if (!providerCode || !supplierSku) {
    notFound()
  }

  const partId = await resolveSupplierProductPartIdByLookup({
    providerCode,
    sku: supplierSku
  })
  if (partId) {
    redirect(`/${locale}/part/${partId}`)
  }

  notFound()
}
