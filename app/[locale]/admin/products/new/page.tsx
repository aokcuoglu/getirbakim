import { AdminLayout } from '@/components/admin/admin-layout'
import {
  AdminPageHeader,
  AdminPageShell,
  AdminSurface
} from '@/components/admin/admin-page-shell'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { getBrands, getPartCategories } from '@/lib/actions/product-actions'
import { ProductForm } from './_components/ProductForm'

export default async function NewProductPage() {
  const [brands, categories] = await Promise.all([
    getBrands(),
    getPartCategories()
  ])

  return (
    <AdminLayout>
      <AdminPageShell width="default">
        <AdminPageHeader
          title="Yeni Ürün Ekle"
          description="Sisteme yeni bir yedek parça ekleyin."
          breadcrumbs={getAdminBreadcrumbs('/admin/products/new')}
        />
        <AdminSurface className="p-4 sm:p-6">
          <ProductForm brands={brands} categories={categories} />
        </AdminSurface>
      </AdminPageShell>
    </AdminLayout>
  )
}
