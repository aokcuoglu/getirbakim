import { getSuppliersHubOverview } from '@/lib/admin/suppliers-hub-stats'
import { SuppliersHubClient } from './SuppliersHubClient'

export async function SuppliersAdminContent() {
  const overview = await getSuppliersHubOverview()

  return <SuppliersHubClient overview={overview} />
}
