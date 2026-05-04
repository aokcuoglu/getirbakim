import { AdminLayout } from '@/components/admin/admin-layout'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import {
  getDinamikBrandMappings,
  getSupplierProductMappingsList,
  getSupplierProductMappingsSummary
} from '@/lib/actions/admin-suppliers'
import { SupplierMappingsTabsClient } from '../_components/SupplierMappingsTabsClient'

export default async function AdminSupplierMappingsPage(props: {
  searchParams: Promise<{
    tab?: 'brands' | 'products'
    provider?: string
    q?: string
    brand?: string
    matchState?: 'all' | 'matched' | 'unmatched'
    status?: 'all' | 'approved' | 'ignored' | 'candidate' | 'unmatched'
    page?: string
    limit?: string
  }>
}) {
  const searchParams = await props.searchParams
  const providerCode = searchParams.provider || 'dinamik'
  const activeTab = searchParams.tab === 'brands' ? 'brands' : 'products'
  const shouldLoadBrandTab = activeTab === 'brands' && providerCode === 'dinamik'
  const shouldLoadProductTab = activeTab === 'products'
  const initialProductPage = searchParams.page ? Number(searchParams.page) : 1
  const initialProductLimit = searchParams.limit ? Number(searchParams.limit) : 20
  const initialProductStatus =
    searchParams.status === 'approved' ||
    searchParams.status === 'ignored' ||
    searchParams.status === 'candidate' ||
    searchParams.status === 'unmatched'
      ? searchParams.status
      : ('all' as const)

  const productListParams = {
    providerCode,
    q: searchParams.q || '',
    queryBrand: searchParams.brand || null,
    matchState: searchParams.matchState || 'all',
    mappingStatus: initialProductStatus as 'all' | 'approved' | 'ignored' | 'candidate' | 'unmatched',
    page:
      Number.isFinite(initialProductPage) && initialProductPage > 0
        ? initialProductPage
        : 1,
    limit:
      Number.isFinite(initialProductLimit) && initialProductLimit > 0
        ? Math.min(initialProductLimit, 100)
        : 20
  }

  const [dinamikBrandMappings, supplierProductMappings, initialSummary] =
    await Promise.all([
      shouldLoadBrandTab
        ? getDinamikBrandMappings({ page: 1, limit: 20 })
        : Promise.resolve({
            rows: [] as Awaited<ReturnType<typeof getDinamikBrandMappings>>['rows'],
            pagination: {
              page: 1,
              limit: 20,
              total: 0,
              pages: 1
            },
            summary: {
              total: 0,
              mapped: 0,
              pending: 0,
              unmapped: 0
            },
            filters: {
              q: '',
              status: 'all' as const
            }
          }),
      shouldLoadProductTab
        ? getSupplierProductMappingsList(productListParams)
        : Promise.resolve(null),
      shouldLoadProductTab
        ? getSupplierProductMappingsSummary({
            providerCode,
            q: searchParams.q || '',
            queryBrand: searchParams.brand || null
          })
        : Promise.resolve(null)
    ])

  return (
    <AdminLayout>
      <AdminPageShell>
        <AdminPageHeader
          title="Eşleştirme Merkezi (PART NO)"
          description="Otomatik PART NO eşleştirme çalıştırın; eşleşen/eşleşmeyen kayıtları izleyip gerektiğinde manuel bağlayın."
          eyebrow="Suppliers / Mappings"
        />
        <SupplierMappingsTabsClient
          initialTab={activeTab}
          productTab={{
            initialLoaded: shouldLoadProductTab,
            initialData: supplierProductMappings,
            initialSummary,
            initialFilters: {
              providerCode,
              q: searchParams.q || '',
              brand: searchParams.brand || 'all',
              matchState: searchParams.matchState || 'all',
              status: initialProductStatus,
              page:
                Number.isFinite(initialProductPage) && initialProductPage > 0
                  ? initialProductPage
                  : 1,
              limit:
                Number.isFinite(initialProductLimit) && initialProductLimit > 0
                  ? Math.min(initialProductLimit, 100)
                  : 20
            }
          }}
          brandTab={{
            enabled: providerCode === 'dinamik',
            initialLoaded: shouldLoadBrandTab,
            initialRows: dinamikBrandMappings.rows,
            initialPagination: dinamikBrandMappings.pagination,
            initialSummary: dinamikBrandMappings.summary,
            initialFilters: dinamikBrandMappings.filters
          }}
        />
      </AdminPageShell>
    </AdminLayout>
  )
}
