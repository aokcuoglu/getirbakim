/**
 * Firma-merkezli marka eşleştirme — client-safe sabitler ve tipler.
 *
 * Bu modül SERVER bağımlılığı (db, prisma) İÇERMEZ; hem client bileşenleri hem
 * server kodu güvenle import edebilir. DB erişen fonksiyonlar
 * `supplier-brand-match.ts` içindedir.
 */

export type SupplierKey = 'dinamik' | 'basbug' | 'ptdrk'

export const SUPPLIER_KEYS: SupplierKey[] = ['dinamik', 'basbug', 'ptdrk']

export const SUPPLIER_LABELS: Record<SupplierKey, string> = {
  dinamik: 'Dinamik',
  basbug: 'Başbuğ',
  ptdrk: 'Parçatedarik'
}

export function isSupplierKey(value: string): value is SupplierKey {
  return (SUPPLIER_KEYS as string[]).includes(value)
}

/** Bir tedarikçi marka id'sini o tedarikçinin FK kolonuna uygun tipe çevirir. */
export function parseSupplierBrandId(
  supplier: SupplierKey,
  raw: string | number
): bigint | number {
  const s = String(raw).trim()
  if (supplier === 'ptdrk') return parseInt(s, 10)
  return BigInt(s)
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

/** Eşleştirme adayının kaynağı: kanonik marka ya da üç tedarikçiden biri. */
export type BrandCandidateKind = 'canonical' | SupplierKey

export const CANDIDATE_KIND_LABELS: Record<BrandCandidateKind, string> = {
  canonical: 'Kanonik',
  dinamik: 'Dinamik',
  basbug: 'Başbuğ',
  ptdrk: 'Parçatedarik'
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
