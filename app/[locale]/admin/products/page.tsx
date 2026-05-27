import { Suspense } from 'react'
import { Plus } from 'lucide-react'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { AdminTablePageSkeleton } from '@/components/admin/admin-table-page-skeleton'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { Link, redirect } from '@/lib/navigation'
import { getTranslations } from 'next-intl/server'
import { ProductsAdminContent } from './_components/ProductsAdminContent'

export default async function AdminProductsPage(props: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await props.params
  const searchParams = await props.searchParams

  if (searchParams.tab) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === 'tab' || value == null || value === '') continue
      params.set(key, String(value))
    }
    const query = params.toString()
    redirect({
      href: query ? `/admin/products?${query}` : '/admin/products',
      locale
    })
  }

  const t = await getTranslations('AdminCatalog.products')

  return (
    <AdminPageShell width="wide">
      <AdminPageHeader
        title={t('title')}
        description={t('description')}
        breadcrumbs={getAdminBreadcrumbs('/admin/products')}
        actions={
          <>
            <Link
              href="/admin/products/tools"
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background text-sm font-semibold text-foreground transition-colors hover:bg-muted sm:w-auto"
            >
              {t('toolsLink')}
            </Link>
            <Link
              href="/admin/products/new"
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-white transition-colors hover:bg-primary/90 sm:w-auto"
            >
              <Plus size={16} />
              {t('addProduct')}
            </Link>
          </>
        }
      />
      <Suspense fallback={<AdminTablePageSkeleton />}>
        <ProductsAdminContent searchParams={searchParams} />
      </Suspense>
    </AdminPageShell>
  )
}
