import { Suspense } from 'react'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { AdminTablePageSkeleton } from '@/components/admin/admin-table-page-skeleton'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { getTranslations } from 'next-intl/server'
import { BrandsAdminContent } from './_components/BrandsAdminContent'

export default async function AdminBrandsPage(props: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{
    q?: string
    logoStatus?: string
    matchSide?: string
    page?: string
    limit?: string
  }>
}) {
  await props.params
  const searchParams = await props.searchParams
  const t = await getTranslations('AdminCatalog.brands')

  return (
    <AdminPageShell width="wide">
      <AdminPageHeader
        title={t('title')}
        description={t('description')}
        breadcrumbs={getAdminBreadcrumbs('/admin/brands')}
      />
      <Suspense fallback={<AdminTablePageSkeleton />}>
        <BrandsAdminContent searchParams={searchParams} />
      </Suspense>
    </AdminPageShell>
  )
}
