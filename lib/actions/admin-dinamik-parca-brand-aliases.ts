'use server'

import { Prisma } from '@prisma/client'
import { requireAdminAuth } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { normalizeModel, normalizeBrandName } from '@/lib/matching/code-normalization'

export type BrandAliasStatusFilter = 'all' | 'pending' | 'approved' | 'unmapped'

export type BrandAliasRow = {
  id: number
  dinamikBrand: string
  normalizedDinamikBrand: string
  parcatedarikManufacturerId: number
  parcatedarikManufacturerName: string
  normalizedPcManufacturer: string
  mappingStatus: string
  confidence: number
  matchMethod: string | null
  approvedBy: string | null
  approvedAt: string | null
  updatedAt: string | null
}

export type BrandAliasSummary = {
  total: number
  approved: number
  pending: number
  rejected: number
  ignored: number
  unmatchedBrands: number
}

function buildWhereClause(q: string, status: BrandAliasStatusFilter): Prisma.Sql {
  const conditions: Prisma.Sql[] = []

  if (q) {
    const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`
    conditions.push(Prisma.sql`(a.dinamik_brand ILIKE ${pattern} OR m.name ILIKE ${pattern} OR a.normalized_dinamik_brand ILIKE ${pattern})`)
  }
  if (status === 'approved') {
    conditions.push(Prisma.sql`a.mapping_status = 'APPROVED'`)
  } else if (status === 'pending') {
    conditions.push(Prisma.sql`a.mapping_status = 'PENDING'`)
  } else if (status === 'unmapped') {
    conditions.push(Prisma.sql`a.mapping_status NOT IN ('APPROVED', 'PENDING')`)
  }

  if (conditions.length === 0) {
    return Prisma.sql`1=1`
  }
  return Prisma.sql`(${Prisma.join(conditions, ' AND ')})`
}

export async function getDinamikParcaBrandAliases(input?: {
  q?: string
  status?: BrandAliasStatusFilter
  page?: number
  limit?: number
}): Promise<{
  rows: BrandAliasRow[]
  pagination: { page: number; limit: number; total: number; pages: number }
  summary: BrandAliasSummary
  filters: { q: string; status: string }
}> {
  await requireAdminAuth()

  const page = Math.max(1, input?.page ?? 1)
  const limit = Math.min(Math.max(1, input?.limit ?? 50), 200)
  const q = (input?.q ?? '').trim()
  const status = input?.status ?? 'all'

  try {
    const whereClause = buildWhereClause(q, status)

    const countResult = await db.$queryRaw<
      Array<{ count: bigint }>
    >(Prisma.sql`
      SELECT COUNT(*) AS count
      FROM public.dinamik_parca_brand_aliases a
      LEFT JOIN parcatedarik.manufacturer m ON m.id = a.parcatedarik_manufacturer_id
      WHERE ${whereClause}
    `)
    const total = Number(countResult[0]?.count ?? 0)
    const pages = Math.max(1, Math.ceil(total / limit))
    const offset = (page - 1) * limit

    const rows = await db.$queryRaw<
      Array<{
        id: number
        dinamik_brand: string
        normalized_dinamik_brand: string
        parcatedarik_manufacturer_id: number
        manufacturer_name: string
        normalized_pc_manufacturer: string
        mapping_status: string
        confidence: number
        match_method: string | null
        approved_by: string | null
        approved_at: Date | null
        updated_at: Date | null
      }>
    >(Prisma.sql`
      SELECT a.id, a.dinamik_brand, a.normalized_dinamik_brand,
             a.parcatedarik_manufacturer_id,
             m.name AS manufacturer_name,
             a.normalized_pc_manufacturer,
             a.mapping_status, a.confidence, a.match_method,
             a.approved_by, a.approved_at, a.updated_at
      FROM public.dinamik_parca_brand_aliases a
      LEFT JOIN parcatedarik.manufacturer m ON m.id = a.parcatedarik_manufacturer_id
      WHERE ${whereClause}
      ORDER BY a.confidence DESC, a.dinamik_brand ASC
      LIMIT ${limit} OFFSET ${offset}
    `)

    const summaryResult = await db.$queryRaw<
      Array<{ mapping_status: string; count: bigint }>
    >(Prisma.sql`SELECT mapping_status, COUNT(*) AS count FROM public.dinamik_parca_brand_aliases GROUP BY mapping_status`)

    const totalDinamikBrands = await db.$queryRaw<
      Array<{ count: bigint }>
    >(Prisma.sql`SELECT COUNT(DISTINCT d.brand) AS count FROM dinamik.products d WHERE d.brand IS NOT NULL AND BTRIM(d.brand) <> ''`)

    const mappedBrands = await db.$queryRaw<
      Array<{ count: bigint }>
    >(Prisma.sql`SELECT COUNT(DISTINCT dinamik_brand) AS count FROM public.dinamik_parca_brand_aliases WHERE mapping_status IN ('PENDING', 'APPROVED')`)

    const summary: BrandAliasSummary = {
      total: Number(summaryResult.find(r => r.mapping_status !== '__total__') ? 0 : 0),
      approved: Number(summaryResult.find(r => r.mapping_status === 'APPROVED')?.count ?? 0),
      pending: Number(summaryResult.find(r => r.mapping_status === 'PENDING')?.count ?? 0),
      rejected: Number(summaryResult.find(r => r.mapping_status === 'REJECTED')?.count ?? 0),
      ignored: Number(summaryResult.find(r => r.mapping_status === 'IGNORED')?.count ?? 0),
      unmatchedBrands: Number(totalDinamikBrands[0]?.count ?? 0) - Number(mappedBrands[0]?.count ?? 0)
    }
    summary.total = summary.approved + summary.pending + summary.rejected + summary.ignored

    return {
      rows: rows.map(r => ({
        id: r.id,
        dinamikBrand: r.dinamik_brand,
        normalizedDinamikBrand: r.normalized_dinamik_brand,
        parcatedarikManufacturerId: r.parcatedarik_manufacturer_id,
        parcatedarikManufacturerName: r.manufacturer_name ?? '',
        normalizedPcManufacturer: r.normalized_pc_manufacturer,
        mappingStatus: r.mapping_status,
        confidence: Number(r.confidence),
        matchMethod: r.match_method,
        approvedBy: r.approved_by,
        approvedAt: r.approved_at?.toISOString() ?? null,
        updatedAt: r.updated_at?.toISOString() ?? null
      })),
      pagination: { page, limit, total, pages },
      summary,
      filters: { q, status }
    }
  } catch (error) {
    console.error('[getDinamikParcaBrandAliases] Error:', error)
    return {
      rows: [],
      pagination: { page: 1, limit: 50, total: 0, pages: 0 },
      summary: { total: 0, approved: 0, pending: 0, rejected: 0, ignored: 0, unmatchedBrands: 0 },
      filters: { q: '', status: 'all' }
    }
  }
}

export async function approveDinamikParcaBrandAlias(input: {
  id: number
}): Promise<{ success: boolean; message: string }> {
  await requireAdminAuth()

  try {
    await db.$executeRaw(
      Prisma.sql`UPDATE public.dinamik_parca_brand_aliases
        SET mapping_status = 'APPROVED',
            approved_by = 'admin',
            approved_at = NOW(),
            updated_at = NOW()
        WHERE id = ${input.id}`
    )
    return { success: true, message: 'Marka eşleştirmesi onaylandı.' }
  } catch (error) {
    console.error('[approveDinamikParcaBrandAlias] Error:', error)
    return { success: false, message: 'Onaylama sırasında hata oluştu.' }
  }
}

export async function rejectDinamikParcaBrandAlias(input: {
  id: number
}): Promise<{ success: boolean; message: string }> {
  await requireAdminAuth()

  try {
    await db.$executeRaw(
      Prisma.sql`UPDATE public.dinamik_parca_brand_aliases
        SET mapping_status = 'REJECTED',
            updated_at = NOW()
        WHERE id = ${input.id}`
    )
    return { success: true, message: 'Marka eşleştirmesi reddedildi.' }
  } catch (error) {
    console.error('[rejectDinamikParcaBrandAlias] Error:', error)
    return { success: false, message: 'Reddetme sırasında hata oluştu.' }
  }
}

export async function ignoreDinamikParcaBrandAlias(input: {
  id: number
}): Promise<{ success: boolean; message: string }> {
  await requireAdminAuth()

  try {
    await db.$executeRaw(
      Prisma.sql`UPDATE public.dinamik_parca_brand_aliases
        SET mapping_status = 'IGNORED',
            updated_at = NOW()
        WHERE id = ${input.id}`
    )
    return { success: true, message: 'Marka eşleştirmesi yoksayıldı.' }
  } catch (error) {
    console.error('[ignoreDinamikParcaBrandAlias] Error:', error)
    return { success: false, message: 'Yoksayma sırasında hata oluştu.' }
  }
}

export async function updateDinamikParcaBrandAlias(input: {
  id: number
  parcatedarikManufacturerId: number
  confidence?: number
}): Promise<{ success: boolean; message: string }> {
  await requireAdminAuth()

  try {
    const manufacturer = await db.$queryRaw<
      Array<{ id: number; name: string }>
    >(Prisma.sql`SELECT id, name FROM parcatedarik.manufacturer WHERE id = ${input.parcatedarikManufacturerId}`)

    if (!manufacturer || manufacturer.length === 0) {
      return { success: false, message: 'Üretici bulunamadı.' }
    }

    const mfrName = manufacturer[0].name
    const normalizedPcMfr = normalizeModel(mfrName) || ''

    const confidenceValue = input.confidence ?? 0.95

    await db.$executeRaw(
      Prisma.sql`UPDATE public.dinamik_parca_brand_aliases
        SET parcatedarik_manufacturer_id = ${input.parcatedarikManufacturerId},
            normalized_pc_manufacturer = ${normalizedPcMfr},
            confidence = ${confidenceValue},
            match_method = 'MANUAL',
            mapping_status = 'APPROVED',
            approved_by = 'admin',
            approved_at = NOW(),
            updated_at = NOW()
        WHERE id = ${input.id}`
    )
    return { success: true, message: 'Marka eşleştirmesi güncellendi.' }
  } catch (error) {
    console.error('[updateDinamikParcaBrandAlias] Error:', error)
    return { success: false, message: 'Güncelleme sırasında hata oluştu.' }
  }
}

export async function createDinamikParcaBrandAlias(input: {
  dinamikBrand: string
  parcatedarikManufacturerId: number
  confidence?: number
}): Promise<{ success: boolean; message: string }> {
  await requireAdminAuth()

  const trimmedBrand = input.dinamikBrand.trim()
  if (!trimmedBrand) {
    return { success: false, message: 'Dinamik marka adı boş olamaz.' }
  }

  try {
    const manufacturer = await db.$queryRaw<
      Array<{ id: number; name: string }>
    >(Prisma.sql`SELECT id, name FROM parcatedarik.manufacturer WHERE id = ${input.parcatedarikManufacturerId}`)

    if (!manufacturer || manufacturer.length === 0) {
      return { success: false, message: 'Üretici bulunamadı.' }
    }

    const normalizedDinamik = normalizeModel(trimmedBrand) || ''
    const normalizedPcMfr = normalizeModel(manufacturer[0].name) || ''
    const confidenceValue = input.confidence ?? 0.95

    await db.$executeRaw(
      Prisma.sql`INSERT INTO public.dinamik_parca_brand_aliases (
          dinamik_brand, normalized_dinamik_brand, parcatedarik_manufacturer_id,
          normalized_pc_manufacturer, mapping_status, confidence, match_method,
          approved_by, approved_at
        ) VALUES (
          ${trimmedBrand},
          ${normalizedDinamik},
          ${input.parcatedarikManufacturerId},
          ${normalizedPcMfr},
          'APPROVED',
          ${confidenceValue},
          'MANUAL',
          'admin',
          NOW()
        )
        ON CONFLICT (dinamik_brand, parcatedarik_manufacturer_id)
        DO UPDATE SET
          mapping_status = 'APPROVED',
          confidence = ${confidenceValue},
          approved_by = 'admin',
          approved_at = NOW(),
          updated_at = NOW()`
    )
    return { success: true, message: 'Marka eşleştirmesi oluşturuldu.' }
  } catch (error) {
    console.error('[createDinamikParcaBrandAlias] Error:', error)
    return { success: false, message: 'Oluşturma sırasında hata oluştu.' }
  }
}

export async function deleteDinamikParcaBrandAlias(input: {
  id: number
}): Promise<{ success: boolean; message: string }> {
  await requireAdminAuth()

  try {
    await db.$executeRaw(
      Prisma.sql`DELETE FROM public.dinamik_parca_brand_aliases WHERE id = ${input.id}`
    )
    return { success: true, message: 'Marka eşleştirmesi silindi.' }
  } catch (error) {
    console.error('[deleteDinamikParcaBrandAlias] Error:', error)
    return { success: false, message: 'Silme sırasında hata oluştu.' }
  }
}

export async function searchParcatedarikManufacturers(input: {
  q?: string
  limit?: number
}): Promise<Array<{ id: number; name: string }>> {
  await requireAdminAuth()

  const limit = Math.min(Math.max(1, input?.limit ?? 20), 100)
  const q = (input?.q ?? '').trim()

  try {
    if (!q) {
      return []
    }

    const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`

    const results = await db.$queryRaw<
      Array<{ id: number; name: string }>
    >(Prisma.sql`
      SELECT id, name FROM parcatedarik.manufacturer
      WHERE name ILIKE ${pattern}
      ORDER BY name ASC
      LIMIT ${limit}
    `)
    return results
  } catch (error) {
    console.error('[searchParcatedarikManufacturers] Error:', error)
    return []
  }
}

export async function bulkApproveDinamikParcaBrandAliases(input: {
  ids: number[]
  minConfidence?: number
}): Promise<{ success: boolean; message: string; approved: number }> {
  await requireAdminAuth()

  const ids = input.ids.slice(0, 500)
  if (ids.length === 0) {
    return { success: false, message: 'En az bir ID gerekli.', approved: 0 }
  }

  const minConf = input.minConfidence ?? 0.85

  try {
    const result = await db.$executeRaw(
      Prisma.sql`UPDATE public.dinamik_parca_brand_aliases
        SET mapping_status = 'APPROVED',
            approved_by = 'admin',
            approved_at = NOW(),
            updated_at = NOW()
        WHERE id IN (${Prisma.join(ids)})
          AND confidence >= ${minConf}
          AND mapping_status = 'PENDING'`
    )
    return { success: true, message: `${result} eşleştirme onaylandı.`, approved: result }
  } catch (error) {
    console.error('[bulkApproveDinamikParcaBrandAliases] Error:', error)
    return { success: false, message: 'Toplu onay sırasında hata oluştu.', approved: 0 }
  }
}

export async function getDinamikParcaBrandAliasStats(): Promise<{
  totalAliases: number
  approved: number
  pending: number
  rejected: number
  ignored: number
  totalDinamikBrands: number
  totalPcManufacturers: number
  matchedBrands: number
  unmatchedBrands: number
}> {
  await requireAdminAuth()

  try {
    const byStatus = await db.$queryRaw<
      Array<{ mapping_status: string; count: bigint }>
    >(Prisma.sql`SELECT mapping_status, COUNT(*) AS count FROM public.dinamik_parca_brand_aliases GROUP BY mapping_status`)

    const totalDinamikBrands = await db.$queryRaw<
      Array<{ count: bigint }>
    >(Prisma.sql`SELECT COUNT(DISTINCT d.brand) AS count FROM dinamik.products d WHERE d.brand IS NOT NULL AND BTRIM(d.brand) <> ''`)

    const totalPcManufacturers = await db.$queryRaw<
      Array<{ count: bigint }>
    >(Prisma.sql`SELECT COUNT(*) AS count FROM parcatedarik.manufacturer`)

    const matchedBrands = await db.$queryRaw<
      Array<{ count: bigint }>
    >(Prisma.sql`SELECT COUNT(DISTINCT dinamik_brand) AS count FROM public.dinamik_parca_brand_aliases WHERE mapping_status IN ('PENDING', 'APPROVED')`)

    const statusMap = Object.fromEntries(byStatus.map(r => [r.mapping_status, Number(r.count)]))

    return {
      totalAliases: Object.values(statusMap).reduce((a, b) => a + b, 0),
      approved: statusMap['APPROVED'] ?? 0,
      pending: statusMap['PENDING'] ?? 0,
      rejected: statusMap['REJECTED'] ?? 0,
      ignored: statusMap['IGNORED'] ?? 0,
      totalDinamikBrands: Number(totalDinamikBrands[0]?.count ?? 0),
      totalPcManufacturers: Number(totalPcManufacturers[0]?.count ?? 0),
      matchedBrands: Number(matchedBrands[0]?.count ?? 0),
      unmatchedBrands: Number(totalDinamikBrands[0]?.count ?? 0) - Number(matchedBrands[0]?.count ?? 0)
    }
  } catch (error) {
    console.error('[getDinamikParcaBrandAliasStats] Error:', error)
    return {
      totalAliases: 0, approved: 0, pending: 0, rejected: 0, ignored: 0,
      totalDinamikBrands: 0, totalPcManufacturers: 0, matchedBrands: 0, unmatchedBrands: 0
    }
  }
}