import { AdminLayout } from '@/components/admin/admin-layout'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { getCategories } from '@/lib/actions/category-actions'
import { CategoryForm } from './_components/CategoryForm'

export default async function NewCategoryPage() {
  const categoriesResult = await getCategories()
  const categories = categoriesResult.success ? categoriesResult.flat || [] : []

  return (
    <AdminLayout>
      <AdminPageShell width="default">
        <AdminPageHeader
          title="Create New Category"
          description="Add a new category to organize your products."
          breadcrumbs={getAdminBreadcrumbs('/admin/categories/new')}
        />
        <CategoryForm categories={categories} />
      </AdminPageShell>
    </AdminLayout>
  )
}
