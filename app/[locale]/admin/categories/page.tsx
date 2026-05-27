import { Suspense } from 'react'
import {
  AdminPageHeader,
  AdminPageShell,
  AdminSurface
} from '@/components/admin/admin-page-shell'
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
    <AdminPageShell>
      <AdminPageHeader
        title="Kategoriler"
        description="Kategori ağacını yönetin ve yeni kategoriler oluşturun."
        breadcrumbs={getAdminBreadcrumbs('/admin/categories')}
        actions={
          <Button asChild className="inline-flex w-full items-center gap-2 sm:w-auto">
            <Link href="/admin/categories/new">
              <Plus size={16} />
              Add Category
            </Link>
          </Button>
        }
      />

      <AdminSurface className="p-4">
        <SearchInput
          defaultValue={searchQuery}
          placeholder="Search categories by name..."
        />
      </AdminSurface>

      <Suspense fallback={<AdminTablePageSkeleton kpiCount={0} rowCount={6} />}>
        <CategoriesAdminContent searchQuery={searchQuery} />
      </Suspense>
    </AdminPageShell>
  )
}
