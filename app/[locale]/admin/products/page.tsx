import { Plus } from 'lucide-react'
import { notFound } from 'next/navigation'
import { AdminLayout } from '@/components/admin/admin-layout'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { getAdminProducts } from '@/lib/actions/admin-products'
import { parseAdminProductsUrlState } from '@/lib/admin-products-workbench'
import { Link } from '@/lib/navigation'
import { ProductsAdminClient } from './_components/ProductsAdminClient'

export default async function AdminProductsPage(props: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{
    source?: string
    q?: string
    brand?: string
    category?: string
    stockStatus?: string
    visibility?: string
    syncStatus?: string
    page?: string
    limit?: string
    sortBy?: string
    sortOrder?: string
  }>
}) {
  await props.params
  const searchParams = await props.searchParams
  if (searchParams.source === 'dinamik') {
    notFound()
  }
  const initialState = parseAdminProductsUrlState(searchParams)
  const data = await getAdminProducts(initialState.filters)

  return (
    <AdminLayout>
      <AdminPageShell>
        <AdminPageHeader
          title="Ürün Operasyonu"
          description="Katalog, fiyat, stok ve görünürlük yönetimini tek yerden yönetin."
          eyebrow="Katalog"
          actions={
            <>
              <Link
                href="/admin/products/tools"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted sm:w-auto"
              >
                Araçlar
              </Link>
              <Link
                href="/admin/products/new"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 sm:w-auto"
              >
                <Plus size={18} />
                Ürün Ekle
              </Link>
            </>
          }
        />
        <ProductsAdminClient data={data} initialProductId={initialState.productId} />
      </AdminPageShell>
    </AdminLayout>
  )
}
