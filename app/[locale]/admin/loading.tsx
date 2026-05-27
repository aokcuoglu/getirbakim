import { AdminTablePageSkeleton } from '@/components/admin/admin-table-page-skeleton'

export default function AdminLoading() {
  return <AdminTablePageSkeleton kpiCount={0} rowCount={4} columnCount={4} />
}
