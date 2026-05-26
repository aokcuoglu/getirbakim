import { Plus } from 'lucide-react'
import { AdminLayout } from '@/components/admin/admin-layout'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { listApprovedDpmatchForAdmin } from '@/lib/admin/approved-dpmatch-catalog'
import { parseAdminProductsUrlState } from '@/lib/admin-products-workbench'
import { getAdminProducts } from '@/lib/actions/admin-products'
import { requireAdminAuth } from '@/lib/admin-auth'
import { Link } from '@/lib/navigation'
import { getTranslations } from 'next-intl/server'
import { AdminProductsTabsClient } from './_components/AdminProductsTabsClient'

export default async function AdminProductsPage(props: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{
    tab?: string
    productId?: string
    q?: string
    brand?: string
    category?: string
    stockStatus?: string
    visibility?: string
    syncStatus?: string
    sortBy?: string
    sortOrder?: string
    page?: string
    limit?: string
    dinamikBrand?: string
    manufacturerId?: string
    matchSide?: string
  }>
}) {
  await requireAdminAuth()
  await props.params
  const searchParams = await props.searchParams
  const t = await getTranslations('AdminCatalog.products')

  const initialTab =
    searchParams.tab === 'approved' ? ('approved' as const) : ('catalog' as const)
  const catalogState = parseAdminProductsUrlState(searchParams)

  const manufacturerIdStr = searchParams.manufacturerId
  const manufacturerId = manufacturerIdStr
    ? parseInt(manufacturerIdStr, 10)
    : null
  const matchSide = searchParams.matchSide ?? 'all'

  const [catalogData, approvedData] = await Promise.all([
    getAdminProducts(catalogState.filters),
    listApprovedDpmatchForAdmin({
      q: searchParams.q ?? '',
      dinamikBrand: searchParams.dinamikBrand ?? null,
      manufacturerId:
        manufacturerId != null && !Number.isNaN(manufacturerId) && manufacturerId > 0
          ? manufacturerId
          : null,
      matchSide:
        matchSide === 'matched' ||
        matchSide === 'unmatched' ||
        matchSide === 'dinamik_only' ||
        matchSide === 'pt_only'
          ? matchSide
          : 'all',
      page: parseInt(searchParams.page ?? '1', 10),
      limit: parseInt(searchParams.limit ?? '50', 10)
    })
  ])

  return (
    <AdminLayout>
      <AdminPageShell width="wide">
        <AdminPageHeader
          title={t('title')}
          description={t('description')}
          breadcrumbs={getAdminBreadcrumbs('/admin/products')}
          actions={
            <>
              <Link
                href="/admin/products/tools"
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background text-sm font-semibold text-foreground transition-colors hover:bg-muted sm:w-auto"
              >
                {t('toolsLink')}
              </Link>
              <Link
                href="/admin/products/new"
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-white transition-colors hover:bg-primary/90 sm:w-auto"
              >
                <Plus size={16} />
                {t('addProduct')}
              </Link>
            </>
          }
        />
        <AdminProductsTabsClient
          catalogData={catalogData}
          approvedData={approvedData}
          initialProductId={catalogState.productId}
          initialTab={initialTab}
        />
      </AdminPageShell>
    </AdminLayout>
  )
}
