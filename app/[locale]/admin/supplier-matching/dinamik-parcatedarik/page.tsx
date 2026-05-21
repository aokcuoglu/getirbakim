import { AdminLayout } from '@/components/admin/admin-layout'
import {
  AdminPageHeader,
  AdminPageShell
} from '@/components/admin/admin-page-shell'
import { DinamikParcaTedarikModelMatchingClient } from './_components/DinamikParcaTedarikModelMatchingClient'

export default async function DinamikParcaTedarikModelMatchingPage() {
  return (
    <AdminLayout>
      <AdminPageShell width="wide">
        <AdminPageHeader
          title="Dinamik - ParçaTedarik Model Eşleştirme"
          description="Dinamik barkodlarını ParçaTedarik model verilerine göre eşleştirin, onaylayın ve reddedin."
          eyebrow="Supplier Matching"
        />
        <DinamikParcaTedarikModelMatchingClient />
      </AdminPageShell>
    </AdminLayout>
  )
}