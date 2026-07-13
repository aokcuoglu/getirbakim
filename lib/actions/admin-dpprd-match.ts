'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/admin-auth'
import { deleteCachePattern } from '@/lib/redis'
import { pairedApprovedBrandMatchFilter } from '@/lib/sql/dpprd-exact'
import { populateDpprdMatches } from '@/lib/admin/dpprd-populate'
import {
  populateDnmkOemForSingleProduct,
  bulkApplyOemBridgeForPendingMappings
} from '@/lib/admin/dnprd-oem-bridge'
import { splitReferenceTokens } from '@/lib/matching/code-normalization'
import { classifyRefToken } from '@/lib/matching/parcatedarik-to-parts-resolver'
import type {
  DpprdMatchFilters,
  DpprdMatchListItem,
  DpprdMatchListResult,
  DpprdMatchOverview,
  DpprdMatchOverviewResult,
  DpprdMatchBrandOption,
  DpprdManualSearchCandidate,
  DpprdManualLinkInput,
  DpprdMappingStatus
} from '@/lib/types/dpprd-match'

/**
 * Dinamik ↔ ParçaTedarik (dpprd) product-matching admin actions.
 * Extracted from the retired lib/actions/admin-suppliers.ts. These read
 * v0.dnmk_products / v0.brand_list and maintain v0.product_mappings — the
 * healthy matching layer that feeds OEM codes into the catalog pipeline.
 */

const DPPRD_DEFAULT_PAGE_SIZE = 20
const DPPRD_MAX_PAGE_SIZE = 100
const DPPRD_MANUAL_SEARCH_LIMIT = 25

async function getAdminUserId() {
  const auth = await requireAdminAuth()
  if (!auth?.user?.id) {
    throw new Error('Yetkisiz işlem.')
  }
  return auth.user.id
}

function revalidateSupplierPaths() {
  void deleteCachePattern('catalog:articles:v*')
  void deleteCachePattern('meilisearch:search:v*')
  void deleteCachePattern('meilisearch:fallback:v*')
  revalidatePath('/admin/suppliers/match-products')
}

function toDpprdStatus(value: string | undefined): 'all' | DpprdMappingStatus {
  if (value === 'PENDING' || value === 'APPROVED' || value === 'IGNORED') {
    return value
  }
  return 'all'
}

function toDpprdBrandListId(value: string | number | undefined): number | 'all' {
  if (value === 'all' || value === undefined || value === null) return 'all'
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 'all'
}

interface DpprdOverviewRow {
  status: string
  n: bigint
}

interface DpprdOemWrittenRow {
  n: bigint
}

interface DpprdBrandPairRow {
  brand_list_id: number
  brand_name: string
  pair_count: bigint
}

export async function getDpprdMatchOverview(): Promise<DpprdMatchOverviewResult> {
  await requireAdminAuth()

  const statusRows = await db.$queryRaw<Array<DpprdOverviewRow>>(Prisma.sql`
    SELECT mapping_status AS status, COUNT(*)::bigint AS n
    FROM v0.product_mappings
    GROUP BY mapping_status
  `)

  const overview: DpprdMatchOverview = {
    total: 0,
    pending: 0,
    approved: 0,
    ignored: 0,
    oemWritten: 0
  }

  for (const row of statusRows) {
    const count = Number(row.n)
    overview.total += count
    if (row.status === 'PENDING') overview.pending = count
    else if (row.status === 'APPROVED') overview.approved = count
    else if (row.status === 'IGNORED') overview.ignored = count
  }

  const oemRow = await db.$queryRaw<Array<DpprdOemWrittenRow>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS n
    FROM v0.product_mappings pm
    INNER JOIN v0.dnmk_products d ON d.id = pm.dnmk_products_id
    WHERE pm.mapping_status = 'APPROVED' AND d.oem_no IS NOT NULL
  `)
  overview.oemWritten = Number(oemRow[0]?.n ?? 0)

  const brandRows = await db.$queryRaw<Array<DpprdBrandPairRow>>(Prisma.sql`
    SELECT bl.id AS brand_list_id, bl.brand AS brand_name,
           COUNT(DISTINCT bm.id)::bigint AS pair_count
    FROM v0.brand_mappings bm
    INNER JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
    WHERE ${pairedApprovedBrandMatchFilter}
    GROUP BY bl.id, bl.brand
    ORDER BY bl.brand
  `)

  const brands: DpprdMatchBrandOption[] = brandRows.map((row) => ({
    id: row.brand_list_id,
    name: row.brand_name,
    pairCount: Number(row.pair_count)
  }))

  return { ...overview, brands }
}

interface DpprdListRow {
  id: bigint
  brand_list_id: number
  brand_list_name: string | null
  dnmk_products_id: bigint
  dnmk_stock_code: string
  dnmk_stock_name: string | null
  dnmk_part_no: string | null
  dnmk_brand: string | null
  dnmk_oem_no: string | null
  ptdrk_products_id: number
  ptdrk_part_no: string | null
  ptdrk_title: string
  ptdrk_brand: string | null
  ptdrk_ref_no: string | null
  mapping_status: string
}

export async function listDpprdMatches(
  input?: DpprdMatchFilters
): Promise<DpprdMatchListResult> {
  await requireAdminAuth()

  const page = Math.max(1, Number(input?.page ?? 1))
  const limit = Math.min(
    DPPRD_MAX_PAGE_SIZE,
    Math.max(1, Number(input?.limit ?? DPPRD_DEFAULT_PAGE_SIZE))
  )
  const status = toDpprdStatus(input?.status as string | undefined)
  const brandListId = toDpprdBrandListId(input?.brandListId)
  const q = (input?.q ?? '').trim()

  const whereParts: Prisma.Sql[] = []
  if (status !== 'all') {
    whereParts.push(Prisma.sql`pm.mapping_status = ${status}::text`)
  }
  if (brandListId !== 'all') {
    whereParts.push(Prisma.sql`pm.brand_list_id = ${brandListId}::int`)
  }
  if (q.length > 0) {
    whereParts.push(Prisma.sql`
      (d.stock_code ILIKE ${'%' + q + '%'}
        OR d.part_no ILIKE ${'%' + q + '%'}
        OR p.part_no ILIKE ${'%' + q + '%'}
        OR p.title ILIKE ${'%' + q + '%'})
    `)
  }

  const whereClause =
    whereParts.length === 0
      ? Prisma.empty
      : Prisma.sql`WHERE ${Prisma.join(whereParts, ' AND ')}`

  const offset = (page - 1) * limit

  const totalRows = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS n
    FROM v0.product_mappings pm
    INNER JOIN v0.dnmk_products d ON d.id = pm.dnmk_products_id
    INNER JOIN v0.ptdrk_products p ON p.id = pm.ptdrk_products_id
    ${whereClause}
  `)
  const total = Number(totalRows[0]?.n ?? 0)
  const pages = Math.max(1, Math.ceil(total / limit))

  const rows = await db.$queryRaw<Array<DpprdListRow>>(Prisma.sql`
    SELECT
      pm.id,
      pm.brand_list_id,
      bl.brand AS brand_list_name,
      pm.dnmk_products_id,
      d.stock_code AS dnmk_stock_code,
      d.stock_name AS dnmk_stock_name,
      d.part_no AS dnmk_part_no,
      db.brand AS dnmk_brand,
      d.oem_no AS dnmk_oem_no,
      pm.ptdrk_products_id,
      p.part_no AS ptdrk_part_no,
      p.title AS ptdrk_title,
      pb.name AS ptdrk_brand,
      p.ref_no AS ptdrk_ref_no,
      pm.mapping_status
    FROM v0.product_mappings pm
    INNER JOIN v0.dnmk_products d ON d.id = pm.dnmk_products_id
    INNER JOIN v0.dnmk_brands db ON db.id = d.dnmk_brands_id
    INNER JOIN v0.ptdrk_products p ON p.id = pm.ptdrk_products_id
    INNER JOIN v0.ptdrk_brands pb ON pb.id = p.ptdrk_brands_id
    LEFT JOIN v0.brand_list bl ON bl.id = pm.brand_list_id
    ${whereClause}
    ORDER BY pm.mapping_status
    LIMIT ${limit} OFFSET ${offset}
  `)

  const matches: DpprdMatchListItem[] = rows.map((row) => ({
    id: row.id.toString(),
    brandListId: row.brand_list_id,
    brandListName: row.brand_list_name,
    dnmkProductId: row.dnmk_products_id.toString(),
    dnmkStockCode: row.dnmk_stock_code,
    dnmkStockName: row.dnmk_stock_name,
    dnmkPartNo: row.dnmk_part_no,
    dnmkBrand: row.dnmk_brand,
    dnmkOemNo: row.dnmk_oem_no,
    ptdrkProductId: row.ptdrk_products_id,
    ptdrkPartNo: row.ptdrk_part_no,
    ptdrkTitle: row.ptdrk_title,
    ptdrkBrand: row.ptdrk_brand,
    ptdrkRefNo: row.ptdrk_ref_no,
    mappingStatus: row.mapping_status as DpprdMappingStatus
  }))

  return {
    filters: { q, status, brandListId, page, limit },
    matches,
    pagination: { page, limit, total, pages }
  }
}

export async function bulkPopulateDpprdMatches(input?: {
  apply?: boolean
  limit?: number
}): Promise<{
  success: boolean
  message: string
  stats: { candidates: number; inserted: number; brandPairs: number } | null
}> {
  await requireAdminAuth()

  const apply = input?.apply ?? false
  const limit = input?.limit

  try {
    const stats = await populateDpprdMatches({ apply, limit })
    const message = apply
      ? `${stats.candidates} aday bulundu, ${stats.inserted} yeni eşleştirme eklendi.`
      : `${stats.candidates} aday bulundu (önizleme — uygulananmadı).`
    return {
      success: true,
      message,
      stats: {
        candidates: stats.candidates,
        inserted: stats.inserted,
        brandPairs: stats.brandPairs
      }
    }
  } catch (error) {
    console.error('[bulkPopulateDpprdMatches] error', error)
    return {
      success: false,
      message: 'Toplu eşleştirme sırasında hata oluştu.',
      stats: null
    }
  }
}

export async function bulkApplyOemBridge(input?: {
  limit?: number
}): Promise<{
  success: boolean
  message: string
  stats: { processed: number; oemWritten: number; cleared: number } | null
}> {
  await requireAdminAuth()

  try {
    const stats = await bulkApplyOemBridgeForPendingMappings({
      limit: input?.limit
    })
    revalidateSupplierPaths()
    return {
      success: true,
      message: `${stats.processed} eşleştirme işlendi. ${stats.oemWritten} OEM yazıldı, ${stats.cleared} ref_no'da OEM bulunamadı.`,
      stats: {
        processed: stats.processed,
        oemWritten: stats.oemWritten,
        cleared: stats.cleared
      }
    }
  } catch (error) {
    console.error('[bulkApplyOemBridge] error', error)
    return {
      success: false,
      message: 'Toplu OEM köprüsü sırasında hata oluştu.',
      stats: null
    }
  }
}

export async function approveDpprdMatch(input: {
  id: string
}): Promise<{ success: boolean; message: string }> {
  await getAdminUserId()
  if (!input?.id) {
    return { success: false, message: 'Eşleştirme ID gerekli.' }
  }

  const rows = await db.$queryRaw<
    Array<{ id: bigint; dnmk_products_id: bigint; ptdrk_products_id: number; ref_no: string | null }>
  >(Prisma.sql`
    SELECT pm.id, pm.dnmk_products_id, pm.ptdrk_products_id, p.ref_no
    FROM v0.product_mappings pm
    INNER JOIN v0.ptdrk_products p ON p.id = pm.ptdrk_products_id
    WHERE pm.id = ${BigInt(input.id)}::bigint
    LIMIT 1
  `)

  if (rows.length === 0) {
    return { success: false, message: 'Eşleştirme kaydı bulunamadı.' }
  }

  const row = rows[0]

  const bridge = await populateDnmkOemForSingleProduct({
    dnmkProductsId: row.dnmk_products_id,
    ptdrkProductsId: row.ptdrk_products_id,
    apply: true
  })

  await db.$executeRaw(Prisma.sql`
    UPDATE v0.product_mappings
    SET mapping_status = 'APPROVED'
    WHERE id = ${row.id}::bigint
  `)

  revalidateSupplierPaths()
  return {
    success: true,
    message: bridge.oemNo
      ? `Eşleştirme onaylandı. OEM köprüsü uygulandı (${bridge.oemTokens.length} OEM token).`
      : 'Eşleştirme onaylandı. ptdrk.ref_no içinde OEM token bulunamadı; dnmk.oem_no temizlendi.'
  }
}

export async function ignoreDpprdMatch(input: {
  id: string
}): Promise<{ success: boolean; message: string }> {
  await requireAdminAuth()
  if (!input?.id) {
    return { success: false, message: 'Eşleştirme ID gerekli.' }
  }

  await db.$executeRaw(Prisma.sql`
    UPDATE v0.product_mappings
    SET mapping_status = 'IGNORED'
    WHERE id = ${BigInt(input.id)}::bigint
  `)

  revalidateSupplierPaths()
  return { success: true, message: 'Eşleştirme yoksayıldı.' }
}

export async function bulkApproveDpprdMatches(input: {
  ids: string[]
}): Promise<{ success: boolean; message: string; affected: number }> {
  await getAdminUserId()
  if (!input?.ids || input.ids.length === 0) {
    return { success: false, message: 'En az bir eşleştirme seçin.', affected: 0 }
  }

  let affected = 0
  for (const idStr of input.ids) {
    const result = await approveDpprdMatch({ id: idStr })
    if (result.success) affected += 1
  }

  revalidateSupplierPaths()
  return {
    success: true,
    message: `${affected}/${input.ids.length} eşleştirme onaylandı.`,
    affected
  }
}

export async function searchPtdrkForManualMatch(input: {
  dnmkProductId: string
  q?: string
  limit?: number
}): Promise<{ success: boolean; message: string; candidates: DpprdManualSearchCandidate[] }> {
  await requireAdminAuth()
  if (!input?.dnmkProductId) {
    return { success: false, message: 'Dinamik ürün ID gerekli.', candidates: [] }
  }

  const q = (input.q ?? '').trim()
  if (q.length === 0) {
    return { success: true, message: 'Arama sorgusu boş.', candidates: [] }
  }

  const limit = Math.min(
    DPPRD_MANUAL_SEARCH_LIMIT,
    Math.max(1, Number(input.limit ?? DPPRD_MANUAL_SEARCH_LIMIT))
  )

  const brandRows = await db.$queryRaw<Array<{ ptdrk_brands_id: number }>>(Prisma.sql`
    SELECT bm.ptdrk_brands_id
    FROM v0.dnmk_products d
    INNER JOIN v0.brand_mappings bm ON bm.dnmk_brands_id = d.dnmk_brands_id
    WHERE d.id = ${BigInt(input.dnmkProductId)}::bigint
      AND ${pairedApprovedBrandMatchFilter}
  `)

  if (brandRows.length === 0) {
    return {
      success: false,
      message:
        'Bu Dinamik ürünün markası için onaylı ParçaTedarik marka eşleştirmesi yok. Önce /admin/brands üzerinden markayı onaylayın.',
      candidates: []
    }
  }

  const ptdrkBrandIds = brandRows.map((r) => r.ptdrk_brands_id)

  const rows = await db.$queryRaw<
    Array<{
      id: number
      part_no: string | null
      title: string
      ref_no: string | null
      brand_name: string | null
      ptdrk_brands_id: number
    }>
  >(Prisma.sql`
    SELECT p.id, p.part_no, p.title, p.ref_no, pb.name AS brand_name, p.ptdrk_brands_id
    FROM v0.ptdrk_products p
    INNER JOIN v0.ptdrk_brands pb ON pb.id = p.ptdrk_brands_id
    WHERE p.ptdrk_brands_id IN (${Prisma.join(ptdrkBrandIds)})
      AND (
        p.part_no ILIKE ${'%' + q + '%'}
        OR p.title ILIKE ${'%' + q + '%'}
        OR p.ref_no ILIKE ${'%' + q + '%'}
      )
    ORDER BY
      CASE WHEN p.part_no ILIKE ${q + '%'} THEN 0 ELSE 1 END,
      p.title
    LIMIT ${limit}
  `)

  const candidates: DpprdManualSearchCandidate[] = rows.map((row) => {
    let previewOemNo: string | null = null
    if (row.ref_no && row.ref_no.trim().length > 0) {
      const tokens = splitReferenceTokens(row.ref_no)
      const oemTokens = tokens
        .filter((t) => classifyRefToken(t) === 'OEM_MATCH')
        .map((t) => t.trim().toUpperCase())
      if (oemTokens.length > 0) previewOemNo = oemTokens.join(',')
    }

    return {
      id: row.id,
      partNo: row.part_no,
      title: row.title,
      refNo: row.ref_no,
      brandName: row.brand_name,
      ptdrkBrandsId: row.ptdrk_brands_id,
      previewOemNo
    }
  })

  return {
    success: true,
    message: `${candidates.length} ParçaTedarik ürünü bulundu.`,
    candidates
  }
}

export async function manualLinkDpprdMatch(
  input: DpprdManualLinkInput
): Promise<{ success: boolean; message: string }> {
  await getAdminUserId()
  if (!input?.dnmkProductId || !input?.ptdrkProductId) {
    return { success: false, message: 'Dinamik ve ParçaTedarik ürün ID gerekli.' }
  }

  const pairRows = await db.$queryRaw<
    Array<{ brand_list_id: number; dnmk_products_id: bigint; ptdrk_products_id: number }>
  >(Prisma.sql`
    SELECT bm.brand_list_id, d.id AS dnmk_products_id, p.id AS ptdrk_products_id
    FROM v0.dnmk_products d
    INNER JOIN v0.brand_mappings bm ON bm.dnmk_brands_id = d.dnmk_brands_id
    INNER JOIN v0.ptdrk_products p ON p.ptdrk_brands_id = bm.ptdrk_brands_id
    WHERE d.id = ${BigInt(input.dnmkProductId)}::bigint
      AND p.id = ${input.ptdrkProductId}::int
      AND ${pairedApprovedBrandMatchFilter}
    LIMIT 1
  `)

  if (pairRows.length === 0) {
    return {
      success: false,
      message:
        'Bu çift için onaylı marka eşleştirmesi yok. Önce /admin/brands üzerinden markayı onaylayın.'
    }
  }

  const pair = pairRows[0]

  const bridge = await populateDnmkOemForSingleProduct({
    dnmkProductsId: pair.dnmk_products_id,
    ptdrkProductsId: pair.ptdrk_products_id,
    apply: true
  })

  await db.$executeRaw(Prisma.sql`
    INSERT INTO v0.product_mappings
      (brand_list_id, dnmk_products_id, ptdrk_products_id, mapping_status)
    VALUES
      (${pair.brand_list_id}::int, ${pair.dnmk_products_id}::bigint, ${pair.ptdrk_products_id}::int, 'APPROVED')
    ON CONFLICT (dnmk_products_id, ptdrk_products_id) DO UPDATE
      SET mapping_status = 'APPROVED'
  `)

  revalidateSupplierPaths()
  return {
    success: true,
    message: bridge.oemNo
      ? `Eşleştirme manuel olarak oluşturuldu ve OEM köprüsü uygulandı (${bridge.oemTokens.length} OEM token).`
      : 'Eşleştirme manuel olarak oluşturuldu. ptdrk.ref_no içinde OEM token bulunamadı.'
  }
}
