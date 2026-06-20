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
      <div className="rounded-md border border-border bg-card p-4 text-destructive">
        Error: {result.error}
      </div>
    )
  }

  const categories = result.flat || []

  return <CategoriesTable categories={categories} searchQuery={searchQuery} />
}
