/**
 * Kategori listesinin ürün kartı sözleşmesi.
 *
 * Adı `parts`tan geliyor: veri eskiden public.parts'tan okunuyordu. Bugün
 * kaynak katalog ve CategoryClientWrapper arama sonucunu bu şekle
 * çeviriyor — tip, üreticisi olan `getPartsForVehicle` ölü kod olarak silindikten
 * sonra tek başına kaldığı için buraya taşındı.
 */
export interface PartWithDetails {
  id: number
  name: string
  dedupeKey?: string
  variantCount?: number
  sourceType?: 'part' | 'supplier_product'
  resolvedPartId?: string
  supplierProductId?: number | null
  providerCode?: string | null
  supplierSku?: string | null
  matchType?: 'approved_oem_mapping' | 'manual_mapping' | 'derived_clone'
  canonicalKey?: string
  rankBucket?: number
  price: string | null
  priceSource: 'real' | 'placeholder'
  isPlaceholderPrice: boolean
  isPurchasable: boolean
  brand: {
    id: number
    name: string
    logoUrl: string | null
  }
  images: {
    image: string | null
    thumb: string | null
  }[]
  properties: {
    key: string
    value: string
  }[]
  eans: string[]
  stock?: number
}
