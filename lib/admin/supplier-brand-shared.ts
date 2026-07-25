/**
 * Firma-merkezli marka eşleştirme — client-safe sabitler ve tipler.
 *
 * Bu modül SERVER bağımlılığı (db, prisma) İÇERMEZ; hem client bileşenleri hem
 * server kodu güvenle import edebilir. DB erişen fonksiyonlar
 * `supplier-brand-match.ts` içindedir.
 */

export type SupplierKey = 'dinamik' | 'basbug'

export const SUPPLIER_KEYS: SupplierKey[] = ['dinamik', 'basbug']

export const SUPPLIER_LABELS: Record<SupplierKey, string> = {
  dinamik: 'Dinamik',
  basbug: 'Başbuğ'
}

export function isSupplierKey(value: string): value is SupplierKey {
  return (SUPPLIER_KEYS as string[]).includes(value)
}

/**
 * Bir tedarikçi marka id'sini FK kolonuna uygun tipe çevirir.
 * Dinamik ve başbuğ kolonlarının ikisi de bigint.
 */
export function parseSupplierBrandId(
  _supplier: SupplierKey,
  raw: string | number
): bigint {
  return BigInt(String(raw).trim())
}

export type SupplierBrandMatchStatus = 'all' | 'matched' | 'pending' | 'unmatched'

export type SupplierBrandMatchFilters = {
  supplier: SupplierKey
  status?: SupplierBrandMatchStatus
  q?: string
  page?: number
  limit?: number
}

export type SupplierBrandMatchRow = {
  supplierId: string
  supplierName: string
  mappingId: number | null
  canonicalId: number | null
  canonicalName: string | null
  mappingStatus: string | null
  matchMethod: string | null
}

export type SupplierBrandMatchResult = {
  supplier: SupplierKey
  rows: SupplierBrandMatchRow[]
  pagination: { page: number; limit: number; total: number; pages: number }
  summary: { total: number; matched: number; pending: number; unmatched: number }
  filters: { q: string; status: SupplierBrandMatchStatus }
}

/**
 * Birebir (kelimesi kelimesine) otomatik marka eşleştirmenin sonucu.
 *
 * Üç tedarikçinin marka adları katı bir anahtarla (trim + iç boşluk sadeleştirme
 * + büyük harf; noktalama korunur) gruplanır. Bir ad ≥2 farklı tedarikçide
 * geçiyorsa (veya aynı adlı kanonik zaten varsa) tek kanonik markaya bağlanır.
 */
export type AutoMatchExactResult = {
  /** Otomatik eşleştirmeye uygun bulunan grup sayısı. */
  groupsQualified: number
  /** En az bir marka bağlanan grup sayısı. */
  groupsMatched: number
  /** Yeni bağlanan tedarikçi markası sayısı (toplam). */
  brandsLinked: number
  /** Yeni oluşturulan kanonik marka sayısı. */
  canonicalsCreated: number
  /** Zaten doğru kanonik'e bağlı olduğu için atlanan marka sayısı. */
  alreadyLinked: number
  /** Üyeleri farklı kanoniklere bağlı olduğu için atlanan grup sayısı (manuel karar). */
  conflicts: number
  /** Tedarikçi başına yeni bağlanan marka sayısı. */
  perSupplier: Record<SupplierKey, number>
  /** İnsan-okur adım günlüğü. */
  steps: string[]
}

/** Eşleştirme adayının kaynağı: kanonik marka ya da üç tedarikçiden biri. */
export type BrandCandidateKind = 'canonical' | SupplierKey

export const CANDIDATE_KIND_LABELS: Record<BrandCandidateKind, string> = {
  canonical: 'Kanonik',
  dinamik: 'Dinamik',
  basbug: 'Başbuğ'
}

/**
 * Bir eşleştirme adayı. Kanonik marka doğrudan hedeftir; tedarikçi markası ise
 * (varsa) bağlı olduğu kanonik marka üzerinden, yoksa yeni kanonik oluşturularak
 * hedeflenir.
 */
export type BrandCandidate = {
  kind: BrandCandidateKind
  id: string
  name: string
  canonicalId: number | null
  canonicalName: string | null
}
