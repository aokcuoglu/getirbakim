import { Suspense } from 'react'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { AdminTablePageSkeleton } from '@/components/admin/admin-table-page-skeleton'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { Link } from '@/lib/navigation'
import { Plus } from 'lucide-react'
import { CategoriesAdminContent } from './_components/CategoriesAdminContent'
import { Button } from '@/components/ui/button'
import { SearchInput } from '../products/_components/SearchInput'

export default async function AdminCategoriesPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const params = await searchParams
  const searchQuery = params.q || ''

  return (
    <AdminPageShell width="wide">
      <AdminPageHeader
        title="Kategoriler"
        description="Kategori ağacını yönetin ve yeni kategoriler oluşturun."
        breadcrumbs={getAdminBreadcrumbs('/admin/categories')}
        actions={
          <Button size="sm" asChild>
            <Link href="/admin/categories/new">
              <Plus size={16} className="mr-2" />
              Kategori Ekle
            </Link>
          </Button>
        }
      />

      <div className="rounded-md border border-border bg-card p-4">
        <SearchInput
          defaultValue={searchQuery}
          placeholder="Kategori adı ile ara..."
        />
      </div>

      <Suspense fallback={<AdminTablePageSkeleton kpiCount={0} rowCount={6} />}>
        <CategoriesAdminContent searchQuery={searchQuery} />
      </Suspense>
    </AdminPageShell>
  )
}
