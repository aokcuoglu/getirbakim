import { Link } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { ProductMatchClient } from './_components/ProductMatchClient'

export const dynamic = 'force-dynamic'

export default async function AdminProductsMatchPage() {
  return (
    <AdminPageShell width="wide">
      <AdminPageHeader
        title="Ürün Eşleştirme"
        description="DNMK, BSBG ve PT ürünlerini eşleştirin."
        breadcrumbs={getAdminBreadcrumbs('/admin/products/match')}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/products">
              <ArrowLeft size={14} className="mr-2" />
              Ürünlere Dön
            </Link>
          </Button>
        }
      />
      <ProductMatchClient />
    </AdminPageShell>
  )
}
