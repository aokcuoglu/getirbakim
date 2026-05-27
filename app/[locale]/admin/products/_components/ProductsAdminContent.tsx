import {
  parseDpmatchWorkbenchUrlState
} from '@/lib/admin/dpmatch-workbench-url'
import { ProductsAdminClient } from './ProductsAdminClient'

export function ProductsAdminContent({
  searchParams
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const { filters, productId } = parseDpmatchWorkbenchUrlState(searchParams)

  return (
    <ProductsAdminClient
      initialFilters={filters}
      initialProductId={productId}
    />
  )
}
