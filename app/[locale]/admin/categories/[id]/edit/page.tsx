import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { getCategoryById, getCategories } from '@/lib/actions/category-actions'
import { CategoryForm } from '../../new/_components/CategoryForm'
import { notFound } from 'next/navigation'

export default async function EditCategoryPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const categoryId = parseInt(id)

  const [categoryResult, categoriesResult] = await Promise.all([
    getCategoryById(categoryId),
    getCategories()
  ])

  if (!categoryResult.success || !categoryResult.data) {
    notFound()
  }

  const categories = categoriesResult.success ? categoriesResult.flat || [] : []
  // Filter out the current category and its children from parent options
  const availableParents = categories.filter(
    (cat) => cat.id !== categoryId && cat.parent_id !== categoryId
  )

  return (
    <AdminPageShell width="default">
        <AdminPageHeader
          title="Edit Category"
          description="Update category information and settings."
          breadcrumbs={getAdminBreadcrumbs(`/admin/categories/${categoryId}/edit`, {
            currentLabel: 'Kategori Düzenle'
          })}
        />
        <CategoryForm category={categoryResult.data} categories={availableParents} />
    </AdminPageShell>
  )
}
