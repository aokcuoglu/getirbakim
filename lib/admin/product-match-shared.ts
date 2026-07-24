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

/**
 * Liste/eşleştirme tarafında görünen tedarikçiler. Dinamik/Başbuğ satılabilir
 * offer üretir; Parçatedarik yalnız referans (offer değil) olarak bağlanır.
 */
export type ProductListSupplier = 'dinamik' | 'basbug' | 'ptdrk'

export const PRODUCT_LIST_SUPPLIERS: ProductListSupplier[] = ['dinamik', 'basbug', 'ptdrk']

export const PRODUCT_LIST_SUPPLIER_LABELS: Record<ProductListSupplier, string> = {
  dinamik: 'Dinamik',
  basbug: 'Başbuğ',
  ptdrk: 'Parçatedarik'
}

/** Parçatedarik satılabilir offer değil — yalnız referans olarak bağlanır. */
export const PRODUCT_LIST_SUPPLIER_IS_OFFER: Record<ProductListSupplier, boolean> = {
  dinamik: true,
  basbug: true,
  ptdrk: false
}

/** Bir tedarikçinin onaylı markaları altındaki ürün kapsama sayıları. */
export type SupplierCoverage = {
  supplier: ProductListSupplier
  /** Onaylı marka altındaki aktif ham satır sayısı. */
  total: number
  /** Bunlardan kanonik ürüne bağlanmış (eşleşmiş) olanlar. */
  linked: number
  /** Henüz bağlanmamış (eşleşmeyen) satırlar. */
  unlinked: number
}

export type ProductMatchOverview = {
  suppliers: SupplierCoverage[]
  /** Kanonik ürün (catalog.products) toplamı. */
  canonicalProducts: number
  /** Toplam offer (catalog.product_offers). */
  totalOffers: number
  /** ≥2 farklı tedarikçi offer'ı taşıyan kanonik ürün (gerçek çapraz eşleşme). */
  dualSupplierProducts: number
  /** İncelenmeyi bekleyen belirsiz eşleştirme adayı sayısı. */
  pendingCandidates: number
}

/** Bir matcher'ın döndürdüğü sayımlar (MatchSupplierStats ile aynı şekil). */
export type MatchStats = {
  productsCreated: number
  offersLinked: number
  offersLinkedByOem: number
  namesUpgraded: number
  /** Bu pass'te PENDING kuyruğa eklenen belirsiz aday sayısı. */
  pendingCandidates: number
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

/**
 * Bir belirsiz eşleştirme adayı (product_match_candidates satırı) — inceleme
 * kartında gösterilecek aday ürün.
 */
export type ProductMatchCandidate = {
  candidateId: string
  productId: string
  productName: string
  productPartNo: string
  brandName: string | null
  matchMethod: string
  matchedCode: string | null
  confidence: number | null
  /** Bu aday ürünün mevcut offer'ları (hangi tedarikçiler bağlı). */
  existingSuppliers: ProductSupplierKey[]
}

/**
 * İncelenecek bir ham tedarikçi satırı + ona denk gelen aday ürünler.
 * Şu an yalnız Başbuğ satırları belirsiz kuyruğa düşer.
 */
export type ProductMatchCandidateGroup = {
  supplier: ProductSupplierKey
  supplierProductId: string
  supplierSku: string
  supplierName: string | null
  supplierOem: string | null
  brandName: string | null
  candidates: ProductMatchCandidate[]
}

export type ListProductCandidatesResult = {
  groups: ProductMatchCandidateGroup[]
  total: number
  page: number
  limit: number
}

/* ── Manuel eşleştirme (marka filtreli çalışma alanı) ─────────────────────── */

/** Manuel eşleştirme marka seçicisinde bir kanonik marka + eşleşmemiş sayısı. */
export type ManualMatchBrand = {
  brandId: number
  brandName: string
  /** Bu marka altında offer'ı olmayan aktif dinamik+başbuğ ham satır sayısı. */
  unlinkedCount: number
}

/** Manuel eşleştirmede kaynak olarak seçilebilecek bağlanmamış tedarikçi satırı. */
export type ManualUnlinkedRow = {
  supplier: ProductSupplierKey
  supplierProductId: string
  supplierSku: string
  name: string | null
  partNo: string | null
  oem: string | null
}

/** Bir kaynağa benzerlik oranıyla sıralanmış aday kanonik ürün. */
export type ManualSimilarCandidate = {
  productId: string
  name: string
  partNo: string
  /** 0..1 arası benzerlik oranı (pg_trgm). */
  similarity: number
  existingSuppliers: ProductSupplierKey[]
}

/** Parçatedarik referans ürünü (offer olmaz — yalnız benzerlik/OEM ipucu). */
export type ManualPtdrkReference = {
  ptdrkProductId: string
  title: string
  partNo: string | null
  refNo: string | null
  priceActual: number | null
  /** Parçatedarik dış ürün sayfası (parcatedarik.com). */
  url: string
  similarity: number
}

export type ManualCandidatesResult = {
  candidates: ManualSimilarCandidate[]
  ptdrkReferences: ManualPtdrkReference[]
}

export type ListManualRowsResult = {
  rows: ManualUnlinkedRow[]
  total: number
  page: number
  limit: number
}

/* ── Ürün listesi (eşleşen/eşleşmeyen komple tablo) ───────────────────────── */

export type ProductListStatus = 'all' | 'matched' | 'unmatched'

/**
 * Eşleşen kanonik ürünün offer kapsamı: iki tedarikçili mi yoksa tek mi.
 *   - 'both'    → hem Dinamik hem Başbuğ offer'ı var (gerçek çapraz eşleşme)
 *   - 'dinamik' → yalnız Dinamik offer'ı var
 *   - 'basbug'  → yalnız Başbuğ offer'ı var
 * Eşleşmemiş satırlarda veya offer'ı olmayan kanonik üründe null.
 */
export type ProductMatchCoverage = 'both' | 'dinamik' | 'basbug'

/** Ürün listesi kapsam filtresi (yalnız eşleşen satırlara uygulanır). */
export type ProductListCoverage = 'all' | ProductMatchCoverage

export const PRODUCT_LIST_COVERAGE_LABELS: Record<ProductMatchCoverage, string> = {
  both: 'İki tedarikçili',
  dinamik: 'Yalnız Dinamik',
  basbug: 'Yalnız Başbuğ'
}

/** Tablo satırı: bir tedarikçi ham ürünü + eşleşme durumu. */
export type SupplierProductRow = {
  supplier: ProductListSupplier
  supplierProductId: string
  brandName: string | null
  sku: string
  name: string | null
  partNo: string | null
  oem: string | null
  /** Bir kanonik ürüne bağlı mı (Dinamik/Başbuğ: offer; Parçatedarik: referans). */
  matched: boolean
  canonicalProductId: string | null
  canonicalName: string | null
  /** Bağlı kanonik ürünün tedarikçi offer kapsamı (badge için). */
  coverage: ProductMatchCoverage | null
}

export type ProductListSummary = {
  /** Bu tedarikçi (+arama) altındaki aktif ürün sayısı. */
  total: number
  matched: number
  unmatched: number
}

export type ProductListResult = {
  rows: SupplierProductRow[]
  summary: ProductListSummary
  pagination: { page: number; limit: number; total: number; pages: number }
}
