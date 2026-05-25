import { Suspense } from 'react'
import { AdminLayout } from '@/components/admin/admin-layout'
import { AdminPageHeader, AdminPageShell } from '@/components/admin/admin-page-shell'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { EslestirmeMainClient } from './_components/EslestirmeMainClient'

export default async function EslestirmePage() {
  return (
    <AdminLayout>
      <AdminPageShell width="wide">
        <AdminPageHeader
          title="Eşleştirme Yönetimi"
          description="Dinamik markalarını ParçaTedarik üreticileriyle eşleştirin, ürün verilerini görüntüleyin ve model eşleştirmelerini yönetin."
          breadcrumbs={getAdminBreadcrumbs('/admin/eslestirme')}
        />
        <Suspense fallback={<div className="text-sm text-muted-foreground">Yükleniyor…</div>}>
          <EslestirmeMainClient />
        </Suspense>
      </AdminPageShell>
    </AdminLayout>
  )
}
