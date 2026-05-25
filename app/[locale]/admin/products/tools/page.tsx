import { AdminLayout } from '@/components/admin/admin-layout'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { ProductsBulkActions } from '../_components/ProductsBulkActions'

export default async function AdminProductToolsPage(props: {
  searchParams: Promise<{
    q?: string
    brand?: string
    category?: string
    stockStatus?: string
    visibility?: string
    syncStatus?: string
    sortBy?: string
    sortOrder?: string
  }>
}) {
  const searchParams = await props.searchParams

  return (
    <AdminLayout>
      <AdminPageShell width="narrow">
        <AdminPageHeader
          title="Ürün Araçları"
          description="CSV dışa aktarma ve içe aktarma operasyonlarını bu ekrandan yönetin."
          breadcrumbs={getAdminBreadcrumbs('/admin/products/tools')}
        />
        <ProductsBulkActions
          selectedIds={[]}
          mode="csv"
          filters={{
            q: searchParams.q,
            brandId: searchParams.brand ? Number(searchParams.brand) : null,
            categoryId: searchParams.category ? Number(searchParams.category) : null,
            stockStatus: searchParams.stockStatus as
              | 'all'
              | 'in_stock'
              | 'low_stock'
              | 'out_of_stock'
              | 'zero_price'
              | undefined,
            visibility: searchParams.visibility as 'all' | 'visible' | 'hidden' | undefined,
            syncStatus: searchParams.syncStatus as 'all' | 'OK' | 'PENDING' | 'ERROR' | undefined,
            sortBy: searchParams.sortBy as
              | 'created_at'
              | 'name'
              | 'selling_price'
              | 'supplier_stock_qty'
              | 'last_synced_at'
              | undefined,
            sortOrder: searchParams.sortOrder as 'asc' | 'desc' | undefined
          }}
        />
      </AdminPageShell>
    </AdminLayout>
  )
}
