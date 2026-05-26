import { AdminLayout } from '@/components/admin/admin-layout'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { listApprovedDbrandsForAdmin } from '@/lib/admin/approved-dbrands-catalog'
import { requireAdminAuth } from '@/lib/admin-auth'
import { getTranslations } from 'next-intl/server'
import { ApprovedBrandsAdminClient } from './_components/ApprovedBrandsAdminClient'

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
  await requireAdminAuth()
  await props.params
  const searchParams = await props.searchParams
  const t = await getTranslations('AdminCatalog.brands')

  const logoStatus = searchParams.logoStatus ?? 'all'
  const matchSide = searchParams.matchSide ?? 'all'

  const data = await listApprovedDbrandsForAdmin({
    q: searchParams.q ?? '',
    logoStatus:
      logoStatus === 'missing' || logoStatus === 'has_logo'
        ? logoStatus
        : 'all',
    matchSide:
      matchSide === 'matched' ||
      matchSide === 'dinamik_only' ||
      matchSide === 'pt_only'
        ? matchSide
        : 'all',
    page: parseInt(searchParams.page ?? '1', 10),
    limit: parseInt(searchParams.limit ?? '50', 10)
  })

  return (
    <AdminLayout>
      <AdminPageShell width="wide">
        <AdminPageHeader
          title={t('title')}
          description={t('description')}
          breadcrumbs={getAdminBreadcrumbs('/admin/brands')}
        />
        <ApprovedBrandsAdminClient initialData={data} />
      </AdminPageShell>
    </AdminLayout>
  )
}
