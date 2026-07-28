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

/**
 * Ürün listesi firma filtresi. 'all' = hiçbir firma seçili değil → iki
 * tedarikçinin ham satırları tek tabloda (UNION) listelenir.
 */
export type ProductListSupplierFilter = ProductListSupplier | 'all'

/**
 * Ürün listesindeki marka filtresinin bir seçeneği: tabloda GERÇEKTEN satırı
 * olan kanonik marka.
 *
 * `rowCount`, ekrandaki DİĞER filtreler (firma/durum/kapsam/OEM/arama)
 * uygulandıktan sonra o markanın altında kalan ham satır sayısıdır — seçmeden
 * önce "burada ne var" sorusunu cevaplar.
 */
export type ProductListBrandOption = {
  brandId: number
  brandName: string
  rowCount: number
}

/**
 * Bir tedarikçinin onaylı markaları altındaki ürün kapsama sayıları.
 *
 * Sayım birimi HAM SATIR DEĞİL, ayrı üründür: (kanonik marka, normalize
 * part_no) grubu. Tedarikçiler aynı parçayı birden çok stok kodu ailesiyle
 * listeliyor (ör. "PSA 0209GN" ve "PSA-E 0209.GN"); bunlar tek kanonik ürüne
 * denk gelir ve `uq_offers_product_supplier` gereği yalnız biri offer olur.
 * Satır bazlı sayım bu varyantları "eşleşmeyen" gösteriyordu — oysa ürün
 * kataloğa girmiş ve satılabilir durumdadır. Gerçek boşluk, hiçbir satırı
 * bağlanamamış gruptur.
 */
export type SupplierCoverage = {
  supplier: ProductListSupplier
  /** Onaylı marka altındaki ayrı ürün (marka + normalize part_no) sayısı. */
  total: number
  /** Kanonik ürüne bağlanmış ayrı ürün sayısı. */
  linked: number
  /** Hiçbir satırı bağlanamamış ayrı ürün — gerçek boşluk. */
  unlinked: number
  /** Bağlı bir ürünün altındaki, offer'ı olmayan alternatif ham satır sayısı. */
  variantRows: number
  /** Onaylı marka altındaki toplam aktif ham satır (bilgi amaçlı). */
  rawRows: number
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
 * Satırın part_no anahtarını taşıyan kanonik ürün (varsa) — modalda kısayol.
 *
 * Eskiden bu bir ÇIKMAZDI: matcher yeni ürün açamaz (uq brand+part_no_norm),
 * offer da ekleyemezdi (uq product+supplier_code). Çok-offer'a geçtikten sonra
 * (uq product+supplier+sku) böyle satırlar da bağlanabiliyor; kayıt yalnız
 * "aradığın ürün muhtemelen bu" demek için duruyor.
 */
export type UnmatchedRowConflict = {
  productId: string
  name: string
  partNo: string
  /** Bu ürüne aynı tedarikçiden bağlı mevcut offer'ın SKU'su (yoksa null). */
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

/**
 * Ürün listesi durum filtresi.
 *
 * 'gap' ve 'variant', 'unmatched'ın (offer'ı olmayan satırlar) ayrık iki alt
 * kümesidir — `unmatched = gap + variant`:
 *   - 'variant' → grubunun kanonik ürünü bu tedarikçiden ZATEN kapsanmış;
 *                 satır eksik ürün değil, aynı parçanın ikinci stok kodu
 *   - 'gap'     → gerçek boşluk: bu parça bu tedarikçiden hiç bağlanamamış
 */
export type ProductListStatus = 'all' | 'matched' | 'unmatched' | 'variant' | 'gap'

/** 'unmatched' seçiliyken gösterilen daraltma seçenekleri. */
export const PRODUCT_LIST_UNMATCHED_KINDS = ['gap', 'variant'] as const

export const PRODUCT_LIST_STATUS_LABELS: Record<'variant' | 'gap', string> = {
  variant: 'Alternatif varyant',
  gap: 'Gerçek boşluk'
}

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

/**
 * OEM durumu filtresi — bağlı kanonik ürünün `catalog.product_oems` kaydı var mı.
 *
 * Kaynak ayrımı yapılmaz: PART_NO'dan türetilmiş kod da OEM sayılır, çünkü
 * ekranın sorusu "bu ürüne elle OEM girmem gerekiyor mu".
 *
 * Kapsam filtresi gibi yalnız EŞLEŞMİŞ satırlara uygulanır: kanonik ürünü
 * olmayan ham satıra OEM yazılamaz (modal da izin vermez), dolayısıyla
 * "OEM'i yok" listesine girmesi admin'i yapılamayacak işe götürürdü.
 */
export type ProductListOem = 'all' | 'with' | 'without'

export const PRODUCT_LIST_OEM_LABELS: Record<Exclude<ProductListOem, 'all'>, string> = {
  without: "OEM'i yok",
  with: "OEM'i var"
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
  /**
   * Bağlı kanonik ürünün OEM kodu sayısı; eşleşmemiş satırda null (kanonik ürün
   * yok, dolayısıyla "0 OEM" demek yanlış olurdu).
   */
  oemCount: number | null
  /** Bağlı kanonik ürünün tedarikçi offer kapsamı (badge için). */
  coverage: ProductMatchCoverage | null
  /**
   * Satırın offer'ı yok AMA grubunun kanonik ürünü bu tedarikçiden zaten
   * kapsanmış → alternatif varyant (bkz. ProductListStatus). Eşleşmiş ya da
   * gerçekten boşta olan satırlarda null.
   */
  variantOf: VariantOwner | null
}

/** Alternatif varyant satırının bağlı olduğu — ve onu bloklayan — kanonik ürün. */
export type VariantOwner = {
  productId: string
  /** Kanonik gösterim adı (name_override varsa o). */
  name: string | null
  /** Bu ürünü aynı tedarikçiden tutan mevcut offer'ın SKU'su. */
  blockingSku: string | null
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
