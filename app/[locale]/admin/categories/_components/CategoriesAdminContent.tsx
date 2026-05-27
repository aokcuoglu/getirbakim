import { AdminSurface } from '@/components/admin/admin-page-shell'
import { getCategories } from '@/lib/actions/category-actions'
import { CategoriesTable } from './CategoriesTable'

export async function CategoriesAdminContent({
  searchQuery
}: {
  searchQuery: string
}) {
  const result = await getCategories()

  if (!result.success) {
    return (
      <AdminSurface className="p-4 text-destructive">
        Error: {result.error}
      </AdminSurface>
    )
  }

  const categories = result.flat || []

  return <CategoriesTable categories={categories} searchQuery={searchQuery} />
}
