import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db'

interface SupplierProductPageProps {
  params: Promise<{
    locale: string
    id: string
  }>
}

export const dynamic = 'force-dynamic'
export const dynamicParams = true

export default async function SupplierProductPage({
  params
}: SupplierProductPageProps) {
  const { locale, id } = await params
  const supplierProductId = Number.parseInt(id, 10)

  if (!Number.isInteger(supplierProductId) || supplierProductId <= 0) {
    notFound()
  }

  // Find the mapped part via supplier_part_mappings
  const mapping = await db.supplier_part_mappings.findFirst({
    where: {
      supplier_product_id: supplierProductId,
      status: 'APPROVED',
      part_id: { not: null }
    },
    select: { part_id: true }
  })

  if (mapping?.part_id) {
    redirect(`/${locale}/part/${mapping.part_id}`)
  }

  notFound()
}
