import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import {
  SUPPLIER_KEYS,
  type AutoMatchExactResult,
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
 * İki tedarikçinin (dinamik / başbuğ) marka tablolarını
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
  AutoMatchExactResult,
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

/** Tedarikçi markası başına en uygun tek eşleşme (DISTINCT ON). */
function bestMappingJoin(cfg: SupplierConfig): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN (
      SELECT DISTINCT ON (m.${cfg.fkCol})
        m.${cfg.fkCol} AS supplier_brand_id,
        m.id AS mapping_id,
        m.brand_id AS canonical_id,
        m.mapping_status,
        m.match_method
      FROM catalog.brand_mappings m
      WHERE m.${cfg.fkCol} IS NOT NULL
      ORDER BY
        m.${cfg.fkCol},
        CASE m.mapping_status
          WHEN 'APPROVED' THEN 0
          WHEN 'PENDING' THEN 1
          ELSE 2
        END,
        m.id
    ) mm ON mm.supplier_brand_id = sb.${cfg.idCol}
    LEFT JOIN catalog.brands cb ON cb.id = mm.canonical_id
  `
}

function buildWhere(filters: ReturnType<typeof normalizeFilters>): Prisma.Sql {
  const clauses: Prisma.Sql[] = []

  if (filters.q) {
    const pattern = `%${filters.q.replace(/[%_\\]/g, '\\$&')}%`
    clauses.push(Prisma.sql`supplier_name ILIKE ${pattern}`)
  }

  if (filters.status === 'matched') {
    clauses.push(Prisma.sql`mapping_status = 'APPROVED'`)
  } else if (filters.status === 'pending') {
    clauses.push(Prisma.sql`mapping_status = 'PENDING'`)
  } else if (filters.status === 'unmatched') {
    clauses.push(Prisma.sql`mapping_id IS NULL`)
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
  const mappingJoin = bestMappingJoin(cfg)
  const where = buildWhere(filters)

  // Tek round-trip: KPI (filtresiz) + sayfa sayısı + satırlar.
  const packed = await db.$queryRaw<
    Array<{
      total: number
      summary_total: number
      matched: number
      pending: number
      unmatched: number
      rows: Array<{
        supplier_id: string
        supplier_name: string
        mapping_id: number | null
        canonical_id: number | null
        canonical_name: string | null
        mapping_status: string | null
        match_method: string | null
      }> | null
    }>
  >(Prisma.sql`
    WITH joined AS (
      SELECT
        sb.${cfg.idCol}::text AS supplier_id,
        sb.${cfg.nameCol} AS supplier_name,
        mm.mapping_id,
        mm.canonical_id,
        cb.brand AS canonical_name,
        mm.mapping_status,
        mm.match_method
      FROM ${cfg.table} sb
      ${mappingJoin}
    ),
    filtered AS (
      SELECT * FROM joined
      WHERE ${where}
    ),
    summary AS (
      SELECT
        COUNT(*)::int AS summary_total,
        COUNT(*) FILTER (WHERE mapping_status = 'APPROVED')::int AS matched,
        COUNT(*) FILTER (WHERE mapping_status = 'PENDING')::int AS pending,
        COUNT(*) FILTER (WHERE mapping_id IS NULL)::int AS unmatched
      FROM joined
    )
    SELECT
      (SELECT COUNT(*)::int FROM filtered) AS total,
      s.summary_total,
      s.matched,
      s.pending,
      s.unmatched,
      (
        SELECT COALESCE(json_agg(t), '[]'::json)
        FROM (
          SELECT
            supplier_id,
            supplier_name,
            mapping_id,
            canonical_id,
            canonical_name,
            mapping_status,
            match_method
          FROM filtered
          ORDER BY supplier_name ASC
          LIMIT ${filters.limit} OFFSET ${offset}
        ) t
      ) AS rows
    FROM summary s
  `)

  const pack = packed[0]
  const total = Number(pack?.total ?? 0)
  const rows = pack?.rows ?? []

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
      total: Number(pack?.summary_total ?? 0),
      matched: Number(pack?.matched ?? 0),
      pending: Number(pack?.pending ?? 0),
      unmatched: Number(pack?.unmatched ?? 0)
    },
    filters: { q: filters.q, status: filters.status }
  }
}

/**
 * Eşleştirme adaylarını arar: kanonik markalar + üç tedarikçinin markaları.
 *
 * Kanonik `catalog.brands` çoğu zaman boş olduğundan, aday havuzuna diğer
 * tedarikçilerin markaları da dahil edilir. Her tedarikçi adayı, varsa bağlı olduğu kanonik markayla döner.
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
    const id = BigInt(params.excludeId)
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

// Bir satırda hiç tedarikçi FK'sı kalmadıysa true (silinebilir yetim satır).
// NOT: ptdrk_brand_id projeden kaldırıldı ama KOLON VE VERİ DB'de duruyor.
// Buradaki ve konsolidasyondaki ptdrk referansları veri koruma amaçlıdır:
// çıkarılırsa hâlâ ptdrk bağı olan satırlar yetim sayılıp silinir / değer kaybolur.
const ALL_SUPPLIER_FKS_NULL = Prisma.sql`
  dinamik_brand_id IS NULL AND ptdrk_brand_id IS NULL AND basbug_brand_id IS NULL
`
// Bir satırın kaç tedarikçi kolonu dolu (en dolu satırı tercih ederken sıralama için).
const FILLED_FK_COUNT = Prisma.sql`
  ((dinamik_brand_id IS NOT NULL)::int + (ptdrk_brand_id IS NOT NULL)::int + (basbug_brand_id IS NOT NULL)::int)
`

/**
 * Bir tedarikçi markasını kanonik markaya bağlar — KONSOLİDE eder.
 *
 * Kanonik başına tek satırda ilgili tedarikçi kolonlarını doldurma ilkesi:
 *  A) Bu tedarikçi markası zaten aynı kanonik'e bağlıysa → sadece onayla.
 *  B) Farklı bir kanonik'e/satıra bağlıysa → o satırdan bu FK'yı boşalt, satır
 *     tamamen boşaldıysa sil (taşıma).
 *  C) Hedef kanonik'te bu tedarikçinin kolonu BOŞ bir satır varsa → onu doldur
 *     (en dolu satırı tercih ederek). Yoksa yeni satır ekle.
 *
 * Aynı tedarikçinin birden fazla markası aynı kanonik'e giderse (ör. ABA + ABA-AV
 * → "ABA"), slot dolu olacağı için ek satır açılır — bu beklenen davranış.
 */
async function upsertSupplierMapping(
  tx: Prisma.TransactionClient,
  cfg: SupplierConfig,
  supplierBrandId: bigint | number,
  canonicalId: number,
  method: string = 'MANUAL'
): Promise<void> {
  // A/B) Bu tedarikçi markasının mevcut bağlarını ele al.
  const current = await tx.$queryRaw<Array<{ id: number; brand_id: number }>>(Prisma.sql`
    SELECT id, brand_id FROM catalog.brand_mappings
    WHERE ${cfg.fkCol} = ${supplierBrandId}
  `)
  const alreadyOnTarget = current.find((r) => r.brand_id === canonicalId)
  if (alreadyOnTarget) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE catalog.brand_mappings
      SET mapping_status = 'APPROVED', match_method = ${method}
      WHERE id = ${alreadyOnTarget.id}
    `)
    return
  }
  if (current.length > 0) {
    // Farklı kanonik'e bağlı: bu tedarikçinin FK'sını boşalt, yetim satırları sil.
    await tx.$executeRaw(Prisma.sql`
      UPDATE catalog.brand_mappings SET ${cfg.fkCol} = NULL WHERE ${cfg.fkCol} = ${supplierBrandId}
    `)
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM catalog.brand_mappings
      WHERE id IN (${Prisma.join(current.map((r) => r.id))}) AND ${ALL_SUPPLIER_FKS_NULL}
    `)
  }

  // C) Kanonik'te bu tedarikçinin kolonu boş bir satır varsa doldur; yoksa yeni satır.
  const slot = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT id FROM catalog.brand_mappings
    WHERE brand_id = ${canonicalId} AND ${cfg.fkCol} IS NULL
    ORDER BY ${FILLED_FK_COUNT} DESC, id
    LIMIT 1
  `)
  if (slot[0]?.id) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE catalog.brand_mappings
      SET ${cfg.fkCol} = ${supplierBrandId}, mapping_status = 'APPROVED', match_method = ${method}
      WHERE id = ${slot[0].id}
    `)
  } else {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO catalog.brand_mappings (brand_id, ${cfg.fkCol}, mapping_status, match_method)
      VALUES (${canonicalId}, ${supplierBrandId}, 'APPROVED', ${method})
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

/**
 * Bir tedarikçi markasının bağlantısını kaldırır. Konsolide satırlarda satırın
 * tamamını silmez — yalnız bu tedarikçinin FK kolonunu boşaltır; satırda başka
 * tedarikçi kalmadıysa (yetim) satırı siler.
 */
export async function unlinkSupplierBrand(
  supplier: SupplierKey,
  supplierBrandId: bigint | number
): Promise<boolean> {
  const cfg = SUPPLIER_CONFIG[supplier]
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT id FROM catalog.brand_mappings WHERE ${cfg.fkCol} = ${supplierBrandId}
    `)
    if (rows.length === 0) return false
    await tx.$executeRaw(Prisma.sql`
      UPDATE catalog.brand_mappings SET ${cfg.fkCol} = NULL WHERE ${cfg.fkCol} = ${supplierBrandId}
    `)
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM catalog.brand_mappings
      WHERE id IN (${Prisma.join(rows.map((r) => r.id))}) AND ${ALL_SUPPLIER_FKS_NULL}
    `)
    return true
  })
}

/** Bir tedarikçi marka id'sini FK kolonu tipine çevirir (ikisi de bigint). */
function toSupplierFk(_supplier: SupplierKey, id: string): bigint {
  return BigInt(id)
}

/**
 * Bir tedarikçi markasının şu an APPROVED olarak bağlı olduğu kanonik id (yoksa null).
 * (Birebir otomatik eşleştirmede mevcut/manuel kararlara dokunmamak için kullanılır.)
 */
async function approvedCanonicalFor(
  tx: Prisma.TransactionClient,
  cfg: SupplierConfig,
  supplierBrandId: bigint | number
): Promise<number | null> {
  const rows = await tx.$queryRaw<Array<{ brand_id: number }>>(Prisma.sql`
    SELECT brand_id FROM catalog.brand_mappings
    WHERE ${cfg.fkCol} = ${supplierBrandId} AND mapping_status = 'APPROVED'
    ORDER BY id LIMIT 1
  `)
  return rows[0]?.brand_id ?? null
}

/** Katı eşleşme anahtarı: trim + iç boşluk sadeleştirme + büyük harf (noktalama korunur). */
function exactBrandKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toUpperCase()
}

/**
 * Birebir (kelimesi kelimesine) otomatik marka eşleştirme.
 *
 * İki tedarikçinin (dinamik / başbuğ) marka adları `exactBrandKey`
 * ile gruplanır. Bir grup şu koşulda otomatik eşleştirilir:
 *   - adı ≥2 FARKLI tedarikçide geçiyorsa, VEYA
 *   - aynı ada sahip bir kanonik marka zaten varsa.
 * Grup içindeki bağlanmamış tedarikçi markaları tek kanonik markaya
 * `APPROVED` / `match_method = 'AUTO_EXACT'` olarak bağlanır.
 *
 * Güvenlik ilkeleri (mevcut/manuel kararları korur):
 *   - Zaten APPROVED bağlı markalara dokunulmaz.
 *   - Grup üyeleri BİRDEN FAZLA farklı kanonik'e bağlıysa grup atlanır (conflict).
 *   - Hedef kanonik: üyelerden biri zaten bir kanonik'e bağlıysa O kullanılır;
 *     yoksa addan kanonik oluşturulur/bulunur (mevcut isim-normalizasyonuyla).
 *
 * İdempotenttir: tekrar çalıştırmak yeni bağ oluşturmaz.
 */
export async function autoMatchExactBrands(
  onProgress?: (message: string) => void
): Promise<AutoMatchExactResult> {
  const steps: string[] = []
  const emit = (m: string) => {
    steps.push(m)
    onProgress?.(m)
  }

  // 1) Üç tedarikçinin tüm markalarını yükle.
  const loadSupplier = async (
    supplier: SupplierKey
  ): Promise<Array<{ supplier: SupplierKey; id: string; name: string }>> => {
    const cfg = SUPPLIER_CONFIG[supplier]
    const rows = await db.$queryRaw<Array<{ id: string; name: string | null }>>(Prisma.sql`
      SELECT ${cfg.idCol}::text AS id, ${cfg.nameCol} AS name FROM ${cfg.table}
    `)
    return rows.map((r) => ({ supplier, id: r.id, name: r.name ?? '' }))
  }
  const loaded = await Promise.all(SUPPLIER_KEYS.map(loadSupplier))
  const allBrands = loaded.flat()

  // 2) Tek-tedarikçi gruplarının uygunluğu için mevcut kanonik adları.
  const canonRows = await db.$queryRaw<Array<{ brand: string }>>(
    Prisma.sql`SELECT brand FROM catalog.brands`
  )
  const canonicalNameSet = new Set(canonRows.map((r) => r.brand))

  // 3) Katı anahtara göre grupla.
  type Member = { supplier: SupplierKey; id: string; name: string }
  const groups = new Map<string, { rep: string; members: Member[] }>()
  for (const b of allBrands) {
    const key = exactBrandKey(b.name)
    if (!key) continue
    const g = groups.get(key)
    if (g) g.members.push(b)
    else groups.set(key, { rep: b.name.trim(), members: [b] })
  }
  emit(`${allBrands.length} tedarikçi markası, ${groups.size} benzersiz ad`)

  const { normalizeModel } = await import('@/lib/matching/code-normalization')

  const result: AutoMatchExactResult = {
    groupsQualified: 0,
    groupsMatched: 0,
    brandsLinked: 0,
    canonicalsCreated: 0,
    alreadyLinked: 0,
    conflicts: 0,
    perSupplier: { dinamik: 0, basbug: 0 },
    steps
  }

  for (const { rep, members } of groups.values()) {
    const distinctSuppliers = new Set(members.map((m) => m.supplier))
    const canonName = normalizeModel(rep) ?? rep.trim().toUpperCase()
    const canonicalExists = canonicalNameSet.has(canonName)
    if (distinctSuppliers.size < 2 && !canonicalExists) continue
    result.groupsQualified++

    // Her grup kendi (küçük, idempotent) transaction'ında işlenir.
    const outcome = await db.$transaction(
      async (tx): Promise<
        | { status: 'conflict' }
        | { status: 'skipped' }
        | {
            status: 'ok'
            created: boolean
            linked: number
            already: number
            perSupplier: Record<SupplierKey, number>
          }
      > => {
        // Üyelerin mevcut APPROVED kanoniklerini topla.
        const memberStates = await Promise.all(
          members.map(async (m) => {
            const cfg = SUPPLIER_CONFIG[m.supplier]
            const fk = toSupplierFk(m.supplier, m.id)
            const canonicalId = await approvedCanonicalFor(tx, cfg, fk)
            return { m, cfg, fk, canonicalId }
          })
        )

        const linkedCanonicals = new Set(
          memberStates
            .map((s) => s.canonicalId)
            .filter((v): v is number => v != null)
        )
        // Birden fazla farklı kanonik → belirsiz; manuel karara bırak.
        if (linkedCanonicals.size > 1) return { status: 'conflict' }

        let canonicalId: number
        let created = false
        if (linkedCanonicals.size === 1) {
          canonicalId = [...linkedCanonicals][0]
        } else {
          const newId = await upsertCanonicalBrand(tx, rep)
          if (!newId) return { status: 'skipped' }
          canonicalId = newId
          created = !canonicalExists
        }

        let linked = 0
        let already = 0
        const perSupplier: Record<SupplierKey, number> = { dinamik: 0, basbug: 0 }
        for (const s of memberStates) {
          if (s.canonicalId === canonicalId) {
            already++
            continue
          }
          await upsertSupplierMapping(tx, s.cfg, s.fk, canonicalId, 'AUTO_EXACT')
          linked++
          perSupplier[s.m.supplier]++
        }
        return { status: 'ok', created, linked, already, perSupplier }
      }
    )

    if (outcome.status === 'conflict') {
      result.conflicts++
      continue
    }
    if (outcome.status === 'skipped') continue

    if (outcome.created) {
      result.canonicalsCreated++
      canonicalNameSet.add(canonName)
    }
    result.brandsLinked += outcome.linked
    result.alreadyLinked += outcome.already
    for (const k of SUPPLIER_KEYS) result.perSupplier[k] += outcome.perSupplier[k]
    if (outcome.linked > 0) result.groupsMatched++
  }

  emit(
    `Bitti — ${result.groupsMatched} grup eşleşti, +${result.brandsLinked} marka bağlandı ` +
      `(Dinamik ${result.perSupplier.dinamik}, Başbuğ ${result.perSupplier.basbug}), ` +
      `+${result.canonicalsCreated} kanonik, ` +
      `${result.conflicts} çakışma atlandı`
  )

  return result
}

/**
 * Mevcut ayrı satırları konsolide eder: her (kanonik, durum) grubu için farklı
 * tedarikçilerin FK'larını mümkün olan en az satıra "zip"ler. Aynı tedarikçinin
 * birden fazla markası varsa ek satır kalır. Tek seferlik bakım işlemidir.
 */
export async function consolidateBrandMappings(): Promise<{ before: number; after: number }> {
  return db.$transaction(async (tx) => {
    const beforeRows = await tx.$queryRaw<Array<{ n: bigint }>>(
      Prisma.sql`SELECT COUNT(*)::bigint AS n FROM catalog.brand_mappings`
    )
    const before = Number(beforeRows[0]?.n ?? 0)

    const rows = await tx.$queryRaw<
      Array<{
        id: number
        brand_id: number
        dinamik: bigint | null
        ptdrk: number | null
        basbug: bigint | null
        status: string
        method: string | null
      }>
    >(Prisma.sql`
      SELECT id, brand_id, dinamik_brand_id AS dinamik, ptdrk_brand_id AS ptdrk,
             basbug_brand_id AS basbug, mapping_status AS status, match_method AS method
      FROM catalog.brand_mappings
      ORDER BY brand_id, mapping_status, id
    `)

    // (brand_id, status) bazında grupla.
    const groups = new Map<string, typeof rows>()
    for (const r of rows) {
      const key = `${r.brand_id}::${r.status}`
      const arr = groups.get(key) ?? []
      arr.push(r)
      groups.set(key, arr)
    }

    for (const [key, groupRows] of groups) {
      // Bu grupta zaten tek satır ve ≤1 tedarikçi doluysa dokunma (gereksiz yazma yok).
      const dinamik = [...new Set(groupRows.map((r) => r.dinamik).filter((v): v is bigint => v != null))]
      const ptdrk = [...new Set(groupRows.map((r) => r.ptdrk).filter((v): v is number => v != null))]
      const basbug = [...new Set(groupRows.map((r) => r.basbug).filter((v): v is bigint => v != null))]
      const needed = Math.max(dinamik.length, ptdrk.length, basbug.length, 0)
      if (needed <= 1 && groupRows.length <= 1) continue

      const [brandIdStr, status] = key.split('::')
      const brandId = Number(brandIdStr)
      const method = groupRows.find((r) => r.method)?.method ?? 'MANUAL'

      // Eski satırları sil, konsolide satırları ekle.
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM catalog.brand_mappings
        WHERE id IN (${Prisma.join(groupRows.map((r) => r.id))})
      `)
      for (let i = 0; i < Math.max(needed, 1); i++) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO catalog.brand_mappings
            (brand_id, dinamik_brand_id, ptdrk_brand_id, basbug_brand_id, mapping_status, match_method)
          VALUES (
            ${brandId},
            ${dinamik[i] ?? null},
            ${ptdrk[i] ?? null},
            ${basbug[i] ?? null},
            ${status},
            ${method}
          )
        `)
      }
    }

    const afterRows = await tx.$queryRaw<Array<{ n: bigint }>>(
      Prisma.sql`SELECT COUNT(*)::bigint AS n FROM catalog.brand_mappings`
    )
    return { before, after: Number(afterRows[0]?.n ?? 0) }
  })
}
