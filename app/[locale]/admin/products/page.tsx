import { Suspense } from 'react'
import { GitCompare, Plus, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Link } from '@/lib/navigation'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { AdminTablePageSkeleton } from '@/components/admin/admin-table-page-skeleton'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { CatalogProductsContent } from './_components/CatalogProductsContent'

export const dynamic = 'force-dynamic'

export default async function AdminProductsPage(props: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const searchParams = await props.searchParams

  return (
    <AdminPageShell width="wide">
      <AdminPageHeader
        title="Ürünler"
        description="Ürün kataloğunu yönetin, fiyat ve stok bilgilerini düzenleyin."
        breadcrumbs={getAdminBreadcrumbs('/admin/products')}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/eslestirme">
                <GitCompare size={14} className="mr-2" />
                Eşleştirme
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/products/tools">
                <Wrench size={14} className="mr-2" />
                Araçlar
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/admin/products/new">
                <Plus size={14} className="mr-2" />
                Yeni Ürün
              </Link>
            </Button>
          </>
        }
      />
      <Suspense fallback={<AdminTablePageSkeleton kpiCount={4} />}>
        <CatalogProductsContent searchParams={searchParams} />
      </Suspense>
    </AdminPageShell>
  )
}