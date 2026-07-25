/**
 * Ürün eşleştirme — client-safe sabitler ve tipler (SERVER bağımlılığı YOK).
 * DB erişen fonksiyonlar `product-match.ts` içindedir.
 *
 * Ürün eşleştirme yalnız Dinamik ve Başbuğ içindir; fiyat/stok verebildiğimiz
 * kaynaklar bunlar.
 */

export type ProductSupplierKey = 'dinamik' | 'basbug'

export const PRODUCT_SUPPLIER_KEYS: ProductSupplierKey[] = ['dinamik', 'basbug']

export const PRODUCT_SUPPLIER_LABELS: Record<ProductSupplierKey, string> = {
  dinamik: 'Dinamik',
  basbug: 'Başbuğ'
}

/** Liste/eşleştirme tarafında görünen tedarikçiler; ikisi de satılabilir offer üretir. */
export type ProductListSupplier = 'dinamik' | 'basbug'

export const PRODUCT_LIST_SUPPLIERS: ProductListSupplier[] = ['dinamik', 'basbug']

export const PRODUCT_LIST_SUPPLIER_LABELS: Record<ProductListSupplier, string> = {
  dinamik: 'Dinamik',
  basbug: 'Başbuğ'
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

/**
 * Eşleşmeyen bir satırın neden bağlanamadığını açıklayan çakışma kaydı.
 *
 * Bir ham satır, aynı marka altında aynı part_no_norm'a sahip kanonik ürün
 * ZATEN varsa ve o ürünün bu tedarikçiden bir offer'ı varsa sonsuza kadar
 * bağlanmadan kalır: matcher yeni ürün açamaz (uq brand+part_no_norm) ve
 * offer da ekleyemez (uq product+supplier_code). Aday listesi de bu ürünü
 * elediği için ekran boş görünür — admin'e asıl hedefi bu kayıt gösterir.
 */
export type UnmatchedRowConflict = {
  productId: string
  name: string
  partNo: string
  /** Bu ürünü aynı tedarikçiden tutan mevcut offer'ın SKU'su (yoksa null). */
  blockingSku: string | null
}

export type ManualCandidatesResult = {
  candidates: ManualSimilarCandidate[]
  /** Yalnız eşleşmeyen satırlarda ve yalnız çakışma varsa dolu. */
  conflict?: UnmatchedRowConflict | null
}

/** Ham tedarikçi satırından açılan yeni kanonik ürün. */
export type CreateCanonicalProductResult = {
  productId: string
  partNo: string
  name: string
  /**
   * part_no anahtarı çakıştığı için ürünün kimliği tedarikçi SKU'sundan
   * türetildiyse true (ör. "251010741" dolu → "ABA 251010741").
   */
  usedSkuKey: boolean
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
  /** Bir kanonik ürüne offer olarak bağlı mı. */
  matched: boolean
  canonicalProductId: string | null
  /** Kanonik ürünün gösterim adı: name_override (varsa) yoksa products.name. */
  canonicalName: string | null
  /** Ad admin tarafından override edilmiş mi (tabloda rozetle gösterilir). */
  canonicalNameOverridden: boolean
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
