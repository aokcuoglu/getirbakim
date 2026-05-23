import { AdminLayout } from '@/components/admin/admin-layout'
import {
  AdminPageHeader,
  AdminPageShell
} from '@/components/admin/admin-page-shell'
import { DinamikParcaBrandAliasesClient } from './_components/DinamikParcaBrandAliasesClient'

export default async function DinamikParcaBrandAliasesPage() {
  return (
    <AdminLayout>
      <AdminPageShell width="wide">
        <AdminPageHeader
          title="Dinamik - ParçaTedarik Marka Eşleştirme"
          description="Dinamik markalarını ParçaTedarik üreticileriyle eşleştirin. Model eşleştirmelerinde marka doğrulaması için kullanılır."
          eyebrow="Brand Aliases"
        />
        <DinamikParcaBrandAliasesClient />
      </AdminPageShell>
    </AdminLayout>
  )
}