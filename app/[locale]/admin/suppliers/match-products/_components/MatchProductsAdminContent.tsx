import {
  getDpprdMatchOverview,
  listDpprdMatches
} from '@/lib/actions/admin-suppliers'
import { MatchProductsAdminClient } from './MatchProductsAdminClient'
import type { DpprdMatchFilters } from '@/lib/types/dpprd-match'

export async function MatchProductsAdminContent({
  searchParams
}: {
  searchParams: Record<string, string | undefined>
}) {
  const filters: DpprdMatchFilters = {
    q: searchParams.q,
    status: searchParams.status as DpprdMatchFilters['status'],
    brandListId: searchParams.brandListId
      ? Number(searchParams.brandListId)
      : undefined,
    page: searchParams.page ? Number(searchParams.page) : 1,
    limit: searchParams.limit ? Number(searchParams.limit) : 20
  }

  const [overview, listResult] = await Promise.all([
    getDpprdMatchOverview(),
    listDpprdMatches(filters)
  ])

  return <MatchProductsAdminClient overview={overview} listResult={listResult} />
}