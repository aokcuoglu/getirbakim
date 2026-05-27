import { getAdminCustomers } from '@/lib/actions/admin-customers'
import { CustomersAdminClient } from './CustomersAdminClient'

export async function CustomersAdminContent({
  searchParams
}: {
  searchParams: {
    q?: string
    role?: string
    page?: string
    limit?: string
  }
}) {
  const data = await getAdminCustomers({
    q: searchParams.q,
    role: searchParams.role as 'all' | 'ADMIN' | 'CUSTOMER' | undefined,
    page: searchParams.page ? Number(searchParams.page) : 1,
    limit: searchParams.limit ? Number(searchParams.limit) : 20
  })

  return <CustomersAdminClient data={data} />
}
