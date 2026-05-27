import { Suspense } from 'react'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { AdminTablePageSkeleton } from '@/components/admin/admin-table-page-skeleton'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { RequestsAdminContent } from './_components/RequestsAdminContent'

export default async function AdminRequestsPage(props: {
  searchParams: Promise<{
    q?: string
    type?: string
    status?: string
    source?: string
    from?: string
    to?: string
    page?: string
    limit?: string
  }>
}) {
  const searchParams = await props.searchParams

  return (
    <AdminPageShell>
      <AdminPageHeader
        title="Müşteri Talepleri"
        description="Fiyat soruları, ürün soruları ve bulunamayan ürün bildirimlerini tek ekrandan yönetin."
        breadcrumbs={getAdminBreadcrumbs('/admin/requests')}
      />
      <Suspense fallback={<AdminTablePageSkeleton kpiCount={0} />}>
        <RequestsAdminContent searchParams={searchParams} />
      </Suspense>
    </AdminPageShell>
  )
}
