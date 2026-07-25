import { getAdminCatalogProducts } from '@/lib/actions/admin-catalog'
import { CatalogProductsClient } from './CatalogProductsClient'
import type {
  CatalogSortKey,
  CatalogStatusFilter,
  CatalogStockFilter
} from '@/lib/types/admin-catalog'

export async function CatalogProductsContent({
  searchParams
}: {
  searchParams: {
    q?: string
    status?: string
    stock?: string
    sort?: string
    page?: string
    limit?: string
  }
}) {
  const data = await getAdminCatalogProducts({
    q: searchParams.q,
    status: searchParams.status as CatalogStatusFilter | undefined,
    stock: searchParams.stock as CatalogStockFilter | undefined,
    sort: searchParams.sort as CatalogSortKey | undefined,
    page: searchParams.page ? Number(searchParams.page) : 1,
    limit: searchParams.limit ? Number(searchParams.limit) : undefined
  })

  return <CatalogProductsClient data={data} />
}
