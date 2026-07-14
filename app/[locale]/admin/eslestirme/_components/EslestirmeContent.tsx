import { listSupplierBrandsForMatching } from '@/lib/admin/supplier-brand-match'
import { EslestirmeClient } from './EslestirmeClient'

export async function EslestirmeContent() {
  // İlk yük: varsayılan tedarikçi (dinamik). Diğer tedarikçiler client'ta fetch edilir.
  const initialBrandData = await listSupplierBrandsForMatching({
    supplier: 'dinamik',
    status: 'all',
    page: 1,
    limit: 50
  })

  return <EslestirmeClient initialBrandData={initialBrandData} />
}
