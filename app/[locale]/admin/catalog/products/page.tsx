import { Suspense } from 'react'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { AdminTablePageSkeleton } from '@/components/admin/admin-table-page-skeleton'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { CatalogProductsContent } from './_components/CatalogProductsContent'

export const dynamic = 'force-dynamic'

export default async function AdminCatalogProductsPage(props: {
  searchParams: Promise<{
    q?: string
    status?: string
    stock?: string
    sort?: string
    page?: string
    limit?: string
  }>
}) {
  const searchParams = await props.searchParams

  return (
    <AdminPageShell>
      <AdminPageHeader
        title="Katalog Ürünleri"
        description="Tedarikçi tekliflerinden oluşan kanonik kataloğu yönetin: fiyat override, kilit, durum ve mağaza görünürlüğü."
        breadcrumbs={getAdminBreadcrumbs('/admin/catalog/products')}
      />
      <Suspense fallback={<AdminTablePageSkeleton kpiCount={4} />}>
        <CatalogProductsContent searchParams={searchParams} />
      </Suspense>
    </AdminPageShell>
  )
}
