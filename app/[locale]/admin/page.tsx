import { Suspense } from 'react'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { AdminDashboardSkeleton } from '@/components/admin/admin-dashboard-skeleton'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { Button } from '@/components/ui/button'
import { Link } from '@/lib/navigation'
import { Package, ShoppingCart } from 'lucide-react'
import { AdminDashboardContent } from './_components/AdminDashboardContent'

export default function AdminPage() {
  return (
    <AdminPageShell width="wide">
      <AdminPageHeader
        title="Genel Bakış"
        description="Mağaza performansı, operasyon uyarıları ve son siparişler"
        breadcrumbs={getAdminBreadcrumbs('/admin')}
        actions={
          <>
            <Button variant="outline" size="default" asChild>
              <Link href="/admin/products">
                <Package className="mr-2 h-4 w-4" />
                Ürünler
              </Link>
            </Button>
            <Button size="default" asChild>
              <Link href="/admin/orders">
                <ShoppingCart className="mr-2 h-4 w-4" />
                Siparişler
              </Link>
            </Button>
          </>
        }
      />

      <Suspense fallback={<AdminDashboardSkeleton />}>
        <AdminDashboardContent />
      </Suspense>
    </AdminPageShell>
  )
}
