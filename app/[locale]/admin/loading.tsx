import { AdminLayout } from '@/components/admin/admin-layout'
import { AdminLoadingState } from '@/components/admin/admin-loading-state'

export default function AdminLoading() {
  return (
    <AdminLayout>
      <AdminLoadingState minHeight="min-h-[60vh]" />
    </AdminLayout>
  )
}
