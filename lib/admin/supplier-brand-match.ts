import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import {
  type BrandCandidate,
  type BrandCandidateKind,
  type SupplierBrandMatchFilters,
  type SupplierBrandMatchResult,
  type SupplierBrandMatchStatus,
  type SupplierKey
} from './supplier-brand-shared'

/**
 * Firma-merkezli marka eşleştirme okuma/yazma modeli (SERVER-only — db kullanır).
 *
 * Üç tedarikçinin (dinamik / başbuğ / parçatedarik) marka tablolarını
 * `catalog.brand_mappings` ile LEFT JOIN LATERAL edip her tedarikçi markasını
 * (varsa) kanonik marka eşleşmesiyle birlikte döndürür. Tedarikçi tabloları
 * asimetrik olduğu için (kolon adı `brand` vs `name`, PK BigInt vs Int, FK
 * kolonu farklı) fark tek bir config tablosunda soyutlanır.
 *
 * Client-safe sabitler ve tipler `supplier-brand-shared.ts` içindedir; buradan
 * da re-export edilir ki mevcut server importları çalışmaya devam etsin.
 */

// Client-safe sabit ve tipleri re-export et (server importları için).
export {
  SUPPLIER_KEYS,
  SUPPLIER_LABELS,
  isSupplierKey,
  parseSupplierBrandId
} from './supplier-brand-shared'
export type {
  SupplierKey,
  SupplierBrandMatchStatus,
  SupplierBrandMatchFilters,
  SupplierBrandMatchRow,
  SupplierBrandMatchResult,
  BrandCandidate,
  BrandCandidateKind
} from './supplier-brand-shared'

// Identifier'lar sabit whitelist'ten gelir — Prisma.raw güvenli (kullanıcı girdisi yok).
type SupplierConfig = {
  table: Prisma.Sql
  idCol: Prisma.Sql
  nameCol: Prisma.Sql
  fkCol: Prisma.Sql
}

const SUPPLIER_CONFIG: Record<SupplierKey, SupplierConfig> = {
  dinamik: {
    table: Prisma.raw('catalog.supplier_dinamik_brands'),
    idCol: Prisma.raw('id'),
    nameCol: Prisma.raw('brand'),
    fkCol: Prisma.raw('dinamik_brand_id')
  },
  basbug: {
    table: Prisma.raw('catalog.supplier_basbug_brands'),
    idCol: Prisma.raw('id'),
    nameCol: Prisma.raw('brand'),
    fkCol: Prisma.raw('basbug_brand_id')
  },
  ptdrk: {
    table: Prisma.raw('catalog.ptdrk_brands'),
    idCol: Prisma.raw('id'),
    nameCol: Prisma.raw('name'),
    fkCol: Prisma.raw('ptdrk_brand_id')
  }
}

function normalizeFilters(input: SupplierBrandMatchFilters) {
  const page = Math.max(1, input.page ?? 1)
  const limit = Math.min(Math.max(1, input.limit ?? 50), 200)
  const status: SupplierBrandMatchStatus =
    input.status === 'matched' ||
    input.status === 'pending' ||
    input.status === 'unmatched'
      ? input.status
      : 'all'
  return { q: (input.q ?? '').trim(), status, page, limit }
}

/** LATERAL alt-sorgu: bir tedarikçi markasının en uygun tek eşleşmesini seçer. */
function bestMappingLateral(cfg: SupplierConfig): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT
        m.id AS mapping_id,
        m.brand_id AS canonical_id,
        cb.brand AS canonical_name,
        m.mapping_status,
        m.match_method
      FROM catalog.brand_mappings m
      JOIN catalog.brands cb ON cb.id = m.brand_id
      WHERE m.${cfg.fkCol} = sb.${cfg.idCol}
      ORDER BY
        CASE m.mapping_status
          WHEN 'APPROVED' THEN 0
          WHEN 'PENDING' THEN 1
          ELSE 2
        END,
        m.id
      LIMIT 1
    ) mm ON TRUE
  `
}

function buildWhere(
  filters: ReturnType<typeof normalizeFilters>,
  cfg: SupplierConfig
): Prisma.Sql {
  const clauses: Prisma.Sql[] = []

  if (filters.q) {
    const pattern = `%${filters.q.replace(/[%_\\]/g, '\\$&')}%`
    clauses.push(Prisma.sql`sb.${cfg.nameCol} ILIKE ${pattern}`)
  }

  if (filters.status === 'matched') {
    clauses.push(Prisma.sql`mm.mapping_status = 'APPROVED'`)
  } else if (filters.status === 'pending') {
    clauses.push(Prisma.sql`mm.mapping_status = 'PENDING'`)
  } else if (filters.status === 'unmatched') {
    clauses.push(Prisma.sql`mm.mapping_id IS NULL`)
  }

  if (clauses.length === 0) return Prisma.sql`TRUE`
  return Prisma.join(clauses, ' AND ')
}

export async function listSupplierBrandsForMatching(
  input: SupplierBrandMatchFilters
): Promise<SupplierBrandMatchResult> {
  const cfg = SUPPLIER_CONFIG[input.supplier]
  const filters = normalizeFilters(input)
  const offset = (filters.page - 1) * filters.limit
  const lateral = bestMappingLateral(cfg)
  const where = buildWhere(filters, cfg)

  const countRows = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM ${cfg.table} sb
    ${lateral}
    WHERE ${where}
  `)
  const total = Number(countRows[0]?.count ?? 0)

  // Özet (KPI) her zaman filtresiz — filtre uygulanınca kartlar değişmesin.
  const summaryRows = await db.$queryRaw<
    Array<{ total: number; matched: number; pending: number; unmatched: number }>
  >(Prisma.sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE mm.mapping_status = 'APPROVED')::int AS matched,
      COUNT(*) FILTER (WHERE mm.mapping_status = 'PENDING')::int AS pending,
      COUNT(*) FILTER (WHERE mm.mapping_id IS NULL)::int AS unmatched
    FROM ${cfg.table} sb
    ${lateral}
  `)
  const summary = summaryRows[0] ?? { total: 0, matched: 0, pending: 0, unmatched: 0 }

  const rows = await db.$queryRaw<
    Array<{
      supplier_id: string
      supplier_name: string
      mapping_id: number | null
      canonical_id: number | null
      canonical_name: string | null
      mapping_status: string | null
      match_method: string | null
    }>
  >(Prisma.sql`
    SELECT
      sb.${cfg.idCol}::text AS supplier_id,
      sb.${cfg.nameCol} AS supplier_name,
      mm.mapping_id,
      mm.canonical_id,
      mm.canonical_name,
      mm.mapping_status,
      mm.match_method
    FROM ${cfg.table} sb
    ${lateral}
    WHERE ${where}
    ORDER BY sb.${cfg.nameCol} ASC
    LIMIT ${filters.limit} OFFSET ${offset}
  `)

  return {
    supplier: input.supplier,
    rows: rows.map((r) => ({
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      mappingId: r.mapping_id,
      canonicalId: r.canonical_id,
      canonicalName: r.canonical_name,
      mappingStatus: r.mapping_status,
      matchMethod: r.match_method
    })),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      pages: Math.max(1, Math.ceil(total / filters.limit))
    },
    summary: {
      total: Number(summary.total),
      matched: Number(summary.matched),
      pending: Number(summary.pending),
      unmatched: Number(summary.unmatched)
    },
    filters: { q: filters.q, status: filters.status }
  }
}

/**
 * Eşleştirme adaylarını arar: kanonik markalar + üç tedarikçinin markaları.
 *
 * Kanonik `catalog.brands` çoğu zaman boş olduğundan, aday havuzuna diğer
 * tedarikçilerin (özellikle Parçatedarik referans kataloğunun) markaları da
 * dahil edilir. Her tedarikçi adayı, varsa bağlı olduğu kanonik markayla döner.
 */
export async function searchBrandCandidates(params: {
  q: string
  excludeSupplier?: SupplierKey
  excludeId?: string
  limit?: number
}): Promise<BrandCandidate[]> {
  const q = (params.q ?? '').trim()
  if (!q) return []
  const limit = Math.min(Math.max(1, params.limit ?? 50), 100)
  const esc = (s: string) => s.replace(/[%_\\]/g, '\\$&')
  const pattern = `%${esc(q)}%`

  // Kök terim: ayraçtan (- / _ boşluk) önceki ilk parça. "ABA-AV" → "ABA".
  // Böylece "ABA-AV" araması "ABA" kanonik/tedarikçi markalarını da getirir.
  const base = q.split(/[-/_\s]+/)[0]
  const hasBase = base.length >= 2 && base.toLowerCase() !== q.toLowerCase()
  const basePattern = hasBase ? `%${esc(base)}%` : null

  // Ad eşleşme koşulu: tam metin veya (varsa) kök terim.
  const nameMatch = (col: Prisma.Sql): Prisma.Sql =>
    basePattern
      ? Prisma.sql`(${col} ILIKE ${pattern} OR ${col} ILIKE ${basePattern})`
      : Prisma.sql`${col} ILIKE ${pattern}`

  // Kaynak markanın kendisini adaylardan çıkar.
  const exclusion = (supplier: SupplierKey, idCol: Prisma.Sql): Prisma.Sql => {
    if (params.excludeSupplier !== supplier || !params.excludeId) return Prisma.empty
    const id = supplier === 'ptdrk' ? Number(params.excludeId) : BigInt(params.excludeId)
    return Prisma.sql`AND ${idCol} <> ${id}`
  }

  const supplierBranch = (
    kind: SupplierKey,
    cfg: SupplierConfig,
    alias: Prisma.Sql
  ): Prisma.Sql => Prisma.sql`
    SELECT ${kind} AS kind, ${alias}.${cfg.idCol}::text AS id, ${alias}.${cfg.nameCol} AS name,
           mm.canonical_id, mm.canonical_name
    FROM ${cfg.table} ${alias}
    LEFT JOIN LATERAL (
      SELECT m.brand_id AS canonical_id, cb.brand AS canonical_name
      FROM catalog.brand_mappings m
      JOIN catalog.brands cb ON cb.id = m.brand_id
      WHERE m.${cfg.fkCol} = ${alias}.${cfg.idCol}
      ORDER BY CASE m.mapping_status WHEN 'APPROVED' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END, m.id
      LIMIT 1
    ) mm ON TRUE
    WHERE ${nameMatch(Prisma.sql`${alias}.${cfg.nameCol}`)} ${exclusion(kind, Prisma.sql`${alias}.${cfg.idCol}`)}
  `

  const rows = await db.$queryRaw<
    Array<{
      kind: string
      id: string
      name: string
      canonical_id: number | null
      canonical_name: string | null
    }>
  >(Prisma.sql`
    SELECT * FROM (
      SELECT 'canonical' AS kind, cb.id::text AS id, cb.brand AS name,
             cb.id AS canonical_id, cb.brand AS canonical_name
      FROM catalog.brands cb
      WHERE ${nameMatch(Prisma.sql`cb.brand`)}
      UNION ALL
      ${supplierBranch('dinamik', SUPPLIER_CONFIG.dinamik, Prisma.raw('d'))}
      UNION ALL
      ${supplierBranch('basbug', SUPPLIER_CONFIG.basbug, Prisma.raw('bs'))}
      UNION ALL
      ${supplierBranch('ptdrk', SUPPLIER_CONFIG.ptdrk, Prisma.raw('pt'))}
    ) t
    ORDER BY
      (LOWER(t.name) = LOWER(${q})) DESC,
      (t.kind = 'canonical') DESC,
      t.name ASC
    LIMIT ${limit}
  `)

  return rows.map((r) => ({
    kind: r.kind as BrandCandidateKind,
    id: r.id,
    name: r.name,
    canonicalId: r.canonical_id,
    canonicalName: r.canonical_name
  }))
}

/** Kanonik markayı ada göre upsert eder (normalize edilmiş). */
async function upsertCanonicalBrand(
  tx: Prisma.TransactionClient,
  name: string
): Promise<number | null> {
  const { normalizeModel } = await import('@/lib/matching/code-normalization')
  const normalized = normalizeModel(name) || name.trim().toUpperCase()
  if (!normalized) return null
  const rows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    INSERT INTO catalog.brands (brand)
    VALUES (${normalized})
    ON CONFLICT (brand) DO UPDATE SET brand = EXCLUDED.brand
    RETURNING id
  `)
  return rows[0]?.id ?? null
}

/**
 * Bir tedarikçi markasını kanonik markaya bağlar (upsert). Tedarikçi başına ayrı
 * satır konvansiyonuna uyar: o tedarikçinin FK'sı dolu mevcut satır varsa
 * günceller, yoksa yeni satır ekler.
 */
async function upsertSupplierMapping(
  tx: Prisma.TransactionClient,
  cfg: SupplierConfig,
  supplierBrandId: bigint | number,
  canonicalId: number
): Promise<void> {
  const existing = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT id FROM catalog.brand_mappings
    WHERE ${cfg.fkCol} = ${supplierBrandId}
    ORDER BY id
    LIMIT 1
  `)
  if (existing[0]?.id) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE catalog.brand_mappings
      SET brand_id = ${canonicalId}, mapping_status = 'APPROVED', match_method = 'MANUAL'
      WHERE id = ${existing[0].id}
    `)
  } else {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO catalog.brand_mappings (brand_id, ${cfg.fkCol}, mapping_status, match_method)
      VALUES (${canonicalId}, ${supplierBrandId}, 'APPROVED', 'MANUAL')
    `)
  }
}

/**
 * Bir tedarikçi markasını bir hedefe bağlar. Hedef üç biçimden biri:
 *  - `canonicalBrandId`: mevcut kanonik marka.
 *  - `targetSupplier` + `targetSupplierBrandId`: başka bir tedarikçi markası —
 *    onun kanonik'i varsa ona, yoksa markanın adından yeni kanonik oluşturulup
 *    hedef de o kanonik'e bağlanır (böylece iki tedarikçi markası ortak kanonik'te
 *    buluşur).
 *  - `newBrandName`: kaynak markanın adından yeni kanonik marka.
 */
export async function linkSupplierBrandToCanonical(params: {
  supplier: SupplierKey
  supplierBrandId: bigint | number
  canonicalBrandId?: number
  targetSupplier?: SupplierKey
  targetSupplierBrandId?: bigint | number
  newBrandName?: string
}): Promise<{ success: boolean; canonicalId?: number; error?: string }> {
  const sCfg = SUPPLIER_CONFIG[params.supplier]

  try {
    const result = await db.$transaction<{ success: boolean; canonicalId?: number; error?: string }>(
      async (tx) => {
        let canonicalId = params.canonicalBrandId

        // Hedef başka bir tedarikçi markası: kanonik'ini bul, yoksa oluştur ve hedefi de bağla.
        if (!canonicalId && params.targetSupplier && params.targetSupplierBrandId != null) {
          const tCfg = SUPPLIER_CONFIG[params.targetSupplier]
          const existing = await tx.$queryRaw<Array<{ canonical_id: number }>>(Prisma.sql`
            SELECT m.brand_id AS canonical_id
            FROM catalog.brand_mappings m
            WHERE m.${tCfg.fkCol} = ${params.targetSupplierBrandId}
            ORDER BY CASE m.mapping_status WHEN 'APPROVED' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END, m.id
            LIMIT 1
          `)
          if (existing[0]?.canonical_id) {
            canonicalId = existing[0].canonical_id
          } else {
            const nameRows = await tx.$queryRaw<Array<{ name: string }>>(Prisma.sql`
              SELECT ${tCfg.nameCol} AS name FROM ${tCfg.table}
              WHERE ${tCfg.idCol} = ${params.targetSupplierBrandId} LIMIT 1
            `)
            const tName = nameRows[0]?.name
            if (!tName) return { success: false, error: 'Hedef marka bulunamadı.' }
            const newId = await upsertCanonicalBrand(tx, tName)
            if (!newId) return { success: false, error: 'Kanonik marka oluşturulamadı.' }
            canonicalId = newId
            await upsertSupplierMapping(tx, tCfg, params.targetSupplierBrandId, canonicalId)
          }
        }

        // Yeni kanonik marka (kaynak markanın adından).
        if (!canonicalId && params.newBrandName?.trim()) {
          const newId = await upsertCanonicalBrand(tx, params.newBrandName)
          if (!newId) return { success: false, error: 'Kanonik marka oluşturulamadı.' }
          canonicalId = newId
        }

        if (!canonicalId) {
          return { success: false, error: 'Hedef kanonik marka çözümlenemedi.' }
        }

        // Kaynak tedarikçi markasını kanonik'e bağla.
        await upsertSupplierMapping(tx, sCfg, params.supplierBrandId, canonicalId)
        return { success: true, canonicalId }
      }
    )
    return result
  } catch (e) {
    console.error('[linkSupplierBrandToCanonical] Error:', e)
    return { success: false, error: 'Eşleştirme kaydedilemedi.' }
  }
}

/** Bir marka eşleştirmesinin durumunu günceller (approve/reject/ignore). */
export async function setBrandMappingStatus(
  mappingId: number,
  status: 'APPROVED' | 'REJECTED' | 'IGNORED'
): Promise<boolean> {
  const updated = await db.$executeRaw(Prisma.sql`
    UPDATE catalog.brand_mappings
    SET mapping_status = ${status}
    WHERE id = ${mappingId}
  `)
  return Number(updated) > 0
}

/** Bir marka eşleştirme satırını siler (bağlantıyı kaldırır). */
export async function deleteBrandMapping(mappingId: number): Promise<boolean> {
  const deleted = await db.$executeRaw(Prisma.sql`
    DELETE FROM catalog.brand_mappings WHERE id = ${mappingId}
  `)
  return Number(deleted) > 0
}
