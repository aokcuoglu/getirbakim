import { listApprovedDbrandsForAdmin } from '@/lib/admin/approved-dbrands-catalog'
import { ApprovedBrandsAdminClient } from './ApprovedBrandsAdminClient'

export async function BrandsAdminContent({
  searchParams
}: {
  searchParams: {
    q?: string
    logoStatus?: string
    matchSide?: string
    page?: string
    limit?: string
  }
}) {
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

  return <ApprovedBrandsAdminClient initialData={data} />
}
