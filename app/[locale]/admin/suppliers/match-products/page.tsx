import { Suspense } from 'react'
import { Link } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import { ArrowRight, Sparkles } from 'lucide-react'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { AdminTablePageSkeleton } from '@/components/admin/admin-table-page-skeleton'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { MatchProductsAdminContent } from './_components/MatchProductsAdminContent'

export const dynamic = 'force-dynamic'

export default async function AdminMatchProductsPage(props: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const searchParams = await props.searchParams

  return (
    <AdminPageShell width="wide">
      <AdminPageHeader
        title="Ürün Eşleştirme"
        description="Dinamik ↔ ParçaTedarik ürün eşleştirme ve OEM köprüsü (ptdrk.ref_no → dnmk.oem_no)."
        breadcrumbs={getAdminBreadcrumbs('/admin/suppliers/match-products')}
        actions={
          <Button size="sm" asChild>
            <Link href="/admin/brands">
              <Sparkles size={14} className="mr-2" />
              Marka Eşleştir
              <ArrowRight size={14} className="ml-2" />
            </Link>
          </Button>
        }
      />
      <Suspense fallback={<AdminTablePageSkeleton kpiCount={5} rowCount={8} />}>
        <MatchProductsAdminContent searchParams={searchParams} />
      </Suspense>
    </AdminPageShell>
  )
}