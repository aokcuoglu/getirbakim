/**
 * Ürün eşleştirme — client-safe sabitler ve tipler (SERVER bağımlılığı YOK).
 * DB erişen fonksiyonlar `product-match.ts` içindedir.
 *
 * Not: ürün eşleştirme yalnız Dinamik ve Başbuğ içindir — Parçatedarik ürünleri
 * `product_offers`'a girmez (OEM zenginleştirme kaynağıdır).
 */

export type ProductSupplierKey = 'dinamik' | 'basbug'

export const PRODUCT_SUPPLIER_KEYS: ProductSupplierKey[] = ['dinamik', 'basbug']

export const PRODUCT_SUPPLIER_LABELS: Record<ProductSupplierKey, string> = {
  dinamik: 'Dinamik',
  basbug: 'Başbuğ'
}

/** Bir tedarikçinin onaylı markaları altındaki ürün kapsama sayıları. */
export type SupplierCoverage = {
  supplier: ProductSupplierKey
  /** Onaylı marka altındaki aktif ham satır sayısı. */
  total: number
  /** Bunlardan bir offer'a bağlanmış (eşleşmiş) olanlar. */
  linked: number
  /** Henüz offer'ı olmayan (eşleşmeyen) satırlar. */
  unlinked: number
}

export type ProductMatchOverview = {
  suppliers: SupplierCoverage[]
  /** Kanonik ürün (catalog.products) toplamı. */
  canonicalProducts: number
  /** Toplam offer (catalog.product_offers). */
  totalOffers: number
}

/** Bir matcher'ın döndürdüğü sayımlar (MatchSupplierStats ile aynı şekil). */
export type MatchStats = {
  productsCreated: number
  offersLinked: number
  offersLinkedByOem: number
  namesUpgraded: number
}

export type ProductMatchRunResult = {
  dinamik: MatchStats
  basbug: MatchStats
  rollups: { rollupsUpdated: number; slugsFilled: number }
  unlinkedBefore: { dinamik: number; basbug: number }
  unlinkedAfter: { dinamik: number; basbug: number }
  /** İnsan-okur adım günlüğü (sırayla). */
  steps: string[]
}
