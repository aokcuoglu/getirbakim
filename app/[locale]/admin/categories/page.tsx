import { AdminLayout } from '@/components/admin/admin-layout'
import {
  AdminPageHeader,
  AdminPageShell,
  AdminSurface
} from '@/components/admin/admin-page-shell'
import { getCategories } from '@/lib/actions/category-actions'
import { Link } from '@/lib/navigation'
import { Plus } from 'lucide-react'
import { CategoriesTable } from './_components/CategoriesTable'
import { Button } from '@/components/ui/button'
import { SearchInput } from '../products/_components/SearchInput'

export default async function AdminCategoriesPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const params = await searchParams
  const searchQuery = params.q || ''

  const result = await getCategories()

  if (!result.success) {
    return (
      <AdminLayout>
        <AdminPageShell>
          <AdminSurface className="p-4 text-red-600">Error: {result.error}</AdminSurface>
        </AdminPageShell>
      </AdminLayout>
    )
  }

  const categories = result.flat || []

  return (
    <AdminLayout>
      <AdminPageShell>
        <AdminPageHeader
          title="Kategoriler"
          description="Kategori ağacını yönetin ve yeni kategoriler oluşturun."
          eyebrow="Katalog"
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

        <CategoriesTable categories={categories} searchQuery={searchQuery} />
      </AdminPageShell>
    </AdminLayout>
  )
}
