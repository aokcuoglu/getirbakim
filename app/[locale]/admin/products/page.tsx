import { AdminLayout } from '@/components/admin/admin-layout'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { listApprovedDpmatchForAdmin } from '@/lib/admin/approved-dpmatch-catalog'
import { requireAdminAuth } from '@/lib/admin-auth'
import { Link } from '@/lib/navigation'
import { getTranslations } from 'next-intl/server'
import { ApprovedDpmatchProductsClient } from './_components/ApprovedDpmatchProductsClient'

export default async function AdminProductsPage(props: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{
    q?: string
    dinamikBrand?: string
    manufacturerId?: string
    matchSide?: string
    page?: string
    limit?: string
  }>
}) {
  await requireAdminAuth()
  await props.params
  const searchParams = await props.searchParams
  const t = await getTranslations('AdminCatalog.products')

  const manufacturerIdStr = searchParams.manufacturerId
  const manufacturerId = manufacturerIdStr
    ? parseInt(manufacturerIdStr, 10)
    : null
  const matchSide = searchParams.matchSide ?? 'all'

  const data = await listApprovedDpmatchForAdmin({
    q: searchParams.q ?? '',
    dinamikBrand: searchParams.dinamikBrand ?? null,
    manufacturerId:
      manufacturerId != null && !Number.isNaN(manufacturerId) && manufacturerId > 0
        ? manufacturerId
        : null,
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
          breadcrumbs={getAdminBreadcrumbs('/admin/products')}
          actions={
            <Link
              href="/admin/products/tools"
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background text-sm font-semibold text-foreground transition-colors hover:bg-muted sm:w-auto"
            >
              {t('toolsLink')}
            </Link>
          }
        />
        <ApprovedDpmatchProductsClient initialData={data} />
      </AdminPageShell>
    </AdminLayout>
  )
}
