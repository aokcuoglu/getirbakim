import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { listPartnerOrdersForOperator } from '@/lib/partner/order-service'
import { getPartnerOrderOperationsStats } from '@/lib/partner/webhook-dispatcher'
import { PartnerOrdersClient } from './partner-orders-client'

export default async function PartnerOrdersPage() {
  const [queue, stats] = await Promise.all([listPartnerOrdersForOperator(), getPartnerOrderOperationsStats()])
  return <AdminPageShell width="wide">
    <AdminPageHeader title="Partner Siparişleri" description="BakımX talepleri, rezervasyonlar ve webhook teslimatını yönetin." breadcrumbs={getAdminBreadcrumbs('/admin/partner-orders')} />
    <PartnerOrdersClient initialData={{ ...queue, stats }} />
  </AdminPageShell>
}
