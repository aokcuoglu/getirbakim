import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { SUPPLIER_BASBUG } from '@/lib/catalog/catalog-sql'
import { canonicalNameSql, canonicalOverrideJoin } from '@/lib/catalog/canonical-name-sql'
import type {
  ListProductCandidatesResult,
  ProductMatchCandidate,
  ProductMatchCandidateGroup,
  ProductSupplierKey
} from './product-match-shared'

/**
 * Belirsiz ürün eşleştirme adaylarının (catalog.product_match_candidates)
 * okuma/yazma modeli (SERVER-only — db kullanır).
 *
 * OEM örtüşmesi birden çok kanonik ürüne denk gelen ham tedarikçi satırları
 * otomatik bağlanmaz; buradan insan onayı/reddi ile çözülür. Şu an yalnız
 * Başbuğ satırları kuyruğa düşer (Dinamik OEM'leri boş).
 */

export type {
  ListProductCandidatesResult,
  ProductMatchCandidate,
  ProductMatchCandidateGroup
} from './product-match-shared'

export type ListPendingInput = {
  q?: string
  page?: number
  limit?: number
}

/** BigInt id'yi güvenli parse et — geçersizse null (400 için). */
export function parseCandidateId(value: unknown): bigint | null {
  if (value == null) return null
  const s = String(value).trim()
  if (!/^\d+$/.test(s)) return null
  try {
    return BigInt(s)
  } catch {
    return null
  }
}

type GroupRow = {
  bsbg_id: bigint
  malzeme_no: string
  aciklama: string | null
  oem_no: string | null
  brand_name: string | null
}

type CandidateRow = {
  candidate_id: bigint
  bsbg_id: bigint
  product_id: bigint
  match_method: string
  matched_code: string | null
  confidence: Prisma.Decimal | null
  product_name: string
  product_part_no: string
  product_brand: string | null
  has_dinamik: boolean
  has_basbug: boolean
}

/**
 * Bekleyen (PENDING) belirsiz adayları ham tedarikçi satırına göre gruplayıp
 * döndürür. Her grup bir inceleme kartı: ham Başbuğ satırı + N aday kanonik ürün.
 * Sayfalama ham satır (grup) sayısı üzerindedir.
 */
export async function listPendingProductCandidates(
  input: ListPendingInput = {}
): Promise<ListProductCandidatesResult> {
  const page = Math.max(1, input.page ?? 1)
  const limit = Math.min(Math.max(1, input.limit ?? 50), 200)
  const offset = (page - 1) * limit

  const q = input.q?.trim()
  const like = q ? `%${q}%` : null
  const filter = like
    ? Prisma.sql`AND (bp.malzeme_no ILIKE ${like} OR bp.aciklama ILIKE ${like} OR bp.oem_no ILIKE ${like})`
    : Prisma.empty

  const [totalRow] = await db.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
    SELECT COUNT(DISTINCT c.basbug_product_id)::bigint AS total
    FROM catalog.product_match_candidates c
    JOIN catalog.supplier_basbug_products bp ON bp.id = c.basbug_product_id
    WHERE c.status = 'PENDING' AND c.supplier_code = ${SUPPLIER_BASBUG}
    ${filter}
  `)
  const total = Number(totalRow?.total ?? 0)

  const groupRows = await db.$queryRaw<GroupRow[]>(Prisma.sql`
    SELECT
      bp.id AS bsbg_id,
      bp.malzeme_no,
      bp.aciklama,
      bp.oem_no,
      bb.brand AS brand_name
    FROM catalog.product_match_candidates c
    JOIN catalog.supplier_basbug_products bp ON bp.id = c.basbug_product_id
    LEFT JOIN catalog.supplier_basbug_brands bb ON bb.id = bp.brand_id
    WHERE c.status = 'PENDING' AND c.supplier_code = ${SUPPLIER_BASBUG}
    ${filter}
    GROUP BY bp.id, bp.malzeme_no, bp.aciklama, bp.oem_no, bb.brand
    ORDER BY bp.id
    LIMIT ${limit} OFFSET ${offset}
  `)

  if (groupRows.length === 0) {
    return { groups: [], total, page, limit }
  }

  const bsbgIds = groupRows.map((r) => r.bsbg_id)
  const candidateRows = await db.$queryRaw<CandidateRow[]>(Prisma.sql`
    SELECT
      c.id AS candidate_id,
      c.basbug_product_id AS bsbg_id,
      c.product_id,
      c.match_method,
      c.matched_code,
      c.confidence,
      ${canonicalNameSql('p', 'ov')} AS product_name,
      p.part_no AS product_part_no,
      br.brand AS product_brand,
      EXISTS (
        SELECT 1 FROM catalog.product_offers po
        WHERE po.product_id = c.product_id AND po.supplier_code = 'dinamik'
      ) AS has_dinamik,
      EXISTS (
        SELECT 1 FROM catalog.product_offers po
        WHERE po.product_id = c.product_id AND po.supplier_code = 'basbug'
      ) AS has_basbug
    FROM catalog.product_match_candidates c
    JOIN catalog.products p ON p.id = c.product_id
    ${canonicalOverrideJoin('p', 'ov')}
    LEFT JOIN catalog.brands br ON br.id = p.brand_id
    WHERE c.status = 'PENDING'
      AND c.basbug_product_id IN (${Prisma.join(bsbgIds)})
    ORDER BY c.confidence DESC NULLS LAST, c.id
  `)

  const byGroup = new Map<string, ProductMatchCandidate[]>()
  for (const r of candidateRows) {
    const key = r.bsbg_id.toString()
    const existingSuppliers: ProductSupplierKey[] = []
    if (r.has_dinamik) existingSuppliers.push('dinamik')
    if (r.has_basbug) existingSuppliers.push('basbug')
    const list = byGroup.get(key) ?? []
    list.push({
      candidateId: r.candidate_id.toString(),
      productId: r.product_id.toString(),
      productName: r.product_name,
      productPartNo: r.product_part_no,
      brandName: r.product_brand,
      matchMethod: r.match_method,
      matchedCode: r.matched_code,
      confidence: r.confidence == null ? null : Number(r.confidence),
      existingSuppliers
    })
    byGroup.set(key, list)
  }

  const groups: ProductMatchCandidateGroup[] = groupRows.map((g) => ({
    supplier: 'basbug',
    supplierProductId: g.bsbg_id.toString(),
    supplierSku: g.malzeme_no,
    supplierName: g.aciklama,
    supplierOem: g.oem_no,
    brandName: g.brand_name,
    candidates: byGroup.get(g.bsbg_id.toString()) ?? []
  }))

  return { groups, total, page, limit }
}

export type ApproveResult =
  | { ok: true; productId: string }
  | { ok: false; reason: 'NOT_FOUND' }

/**
 * Bir adayı onaylar: seçilen kanonik ürüne Başbuğ offer'ı oluşturur, adayı
 * APPROVED yapar ve aynı ham satırın diğer PENDING kardeşlerini REJECTED'a
 * çeker (bir ham satır tek ürüne bağlanır). Tek transaction; idempotent
 * (offer zaten varsa ON CONFLICT sessiz geçer).
 */
export async function approveProductMatchCandidate(
  candidateId: bigint,
  reviewedBy: string | null
): Promise<ApproveResult> {
  return db.$transaction(async (tx) => {
    const [cand] = await tx.$queryRaw<
      Array<{ product_id: bigint; basbug_product_id: bigint }>
    >(Prisma.sql`
      SELECT product_id, basbug_product_id
      FROM catalog.product_match_candidates
      WHERE id = ${candidateId}
        AND status = 'PENDING'
        AND basbug_product_id IS NOT NULL
      FOR UPDATE
    `)
    if (!cand) return { ok: false as const, reason: 'NOT_FOUND' as const }

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO catalog.product_offers (product_id, supplier_code, basbug_product_id, supplier_sku)
      SELECT ${cand.product_id}, ${SUPPLIER_BASBUG}, ${cand.basbug_product_id}, bp.malzeme_no
      FROM catalog.supplier_basbug_products bp
      WHERE bp.id = ${cand.basbug_product_id}
      ON CONFLICT DO NOTHING
    `)

    await tx.$executeRaw(Prisma.sql`
      UPDATE catalog.product_match_candidates
      SET status = 'APPROVED', reviewed_at = NOW(), reviewed_by = ${reviewedBy}
      WHERE id = ${candidateId}
    `)

    await tx.$executeRaw(Prisma.sql`
      UPDATE catalog.product_match_candidates
      SET status = 'REJECTED', reviewed_at = NOW(), reviewed_by = 'auto:sibling'
      WHERE basbug_product_id = ${cand.basbug_product_id}
        AND status = 'PENDING'
        AND id <> ${candidateId}
    `)

    return { ok: true as const, productId: cand.product_id.toString() }
  })
}

/**
 * Bir adayı reddeder (yalnız o aday). Kardeşler PENDING kalır ki incelemeci
 * doğru olanı hâlâ seçebilsin.
 */
export async function rejectProductMatchCandidate(
  candidateId: bigint,
  reviewedBy: string | null
): Promise<{ ok: boolean }> {
  const updated = await db.$executeRaw(Prisma.sql`
    UPDATE catalog.product_match_candidates
    SET status = 'REJECTED', reviewed_at = NOW(), reviewed_by = ${reviewedBy}
    WHERE id = ${candidateId} AND status = 'PENDING'
  `)
  return { ok: Number(updated) > 0 }
}
