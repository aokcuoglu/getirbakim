import { getAdminCustomerRequests } from '@/lib/actions/customer-requests'
import { RequestsAdminClient } from './RequestsAdminClient'

export async function RequestsAdminContent({
  searchParams
}: {
  searchParams: {
    q?: string
    type?: string
    status?: string
    source?: string
    from?: string
    to?: string
    page?: string
    limit?: string
  }
}) {
  const data = await getAdminCustomerRequests({
    q: searchParams.q,
    type: searchParams.type as
      | 'all'
      | 'PRICE_REQUEST'
      | 'PRODUCT_QUESTION'
      | 'MISSING_PRODUCT'
      | undefined,
    status: searchParams.status as
      | 'all'
      | 'NEW'
      | 'IN_REVIEW'
      | 'RESOLVED'
      | 'ARCHIVED'
      | undefined,
    source: searchParams.source as
      | 'all'
      | 'PRICE_MODAL'
      | 'PRODUCT_FAQ_FORM'
      | 'MISSING_PRODUCT_MODAL'
      | undefined,
    from: searchParams.from,
    to: searchParams.to,
    page: searchParams.page ? Number(searchParams.page) : 1,
    limit: searchParams.limit ? Number(searchParams.limit) : 20
  })

  return <RequestsAdminClient data={data} />
}
