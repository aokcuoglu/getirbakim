'use server'

import { getDinamikBrandMatchStats } from '@/lib/admin/dinamik-brand-match-stats'
import { requireAdminAuth } from '@/lib/admin-auth'
import { resolveDbrandsIdByBrand } from '@/lib/admin/dnbrd-id'
import { normalizeModel } from '@/lib/matching/code-normalization'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export type BrandAliasStatusFilter = 'all' | 'pending' | 'approved' | 'unmapped'

export type BrandAliasRow = {
  id: number
  dinamikBrand: string
  normalizedName: string
  parcatedarikManufacturerId: number
  parcatedarikManufacturerName: string
  mappingStatus: string
  matchMethod: string | null
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
    conditions.push(
      Prisma.sql`(COALESCE(d.brand, '') ILIKE ${pattern} OR pt.name ILIKE ${pattern} OR cb.brand ILIKE ${pattern})`
    )
  }
  if (status === 'approved') {
    conditions.push(Prisma.sql`m.mapping_status = 'APPROVED'`)
  } else if (status === 'pending') {
    conditions.push(Prisma.sql`m.mapping_status = 'PENDING'`)
  } else if (status === 'unmapped') {
    conditions.push(Prisma.sql`m.mapping_status NOT IN ('APPROVED', 'PENDING')`)
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
      FROM v0.brand_mappings m
      JOIN v0.brand_list cb ON cb.id = m.brand_list_id
      LEFT JOIN v0.dnmk_brands d ON d.id = m.dnmk_brands_id
      LEFT JOIN v0.ptdrk_brands pt ON pt.id = m.ptdrk_brands_id
      WHERE ${whereClause}
    `)
    const total = Number(countResult[0]?.count ?? 0)
    const pages = Math.max(1, Math.ceil(total / limit))
    const offset = (page - 1) * limit

    const rows = await db.$queryRaw<
      Array<{
        id: number
        dinamik_brand: string | null
        brand: string
        ptdrk_brands_id: number
        manufacturer_name: string
        mapping_status: string
        match_method: string | null
      }>
    >(Prisma.sql`
      SELECT m.id, d.brand AS dinamik_brand,
             cb.brand,
             m.ptdrk_brands_id,
             pt.name AS manufacturer_name,
             m.mapping_status, m.match_method
      FROM v0.brand_mappings m
      JOIN v0.brand_list cb ON cb.id = m.brand_list_id
      LEFT JOIN v0.dnmk_brands d ON d.id = m.dnmk_brands_id
      LEFT JOIN v0.ptdrk_brands pt ON pt.id = m.ptdrk_brands_id
      WHERE ${whereClause}
      ORDER BY d.brand ASC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `)

    const summaryResult = await db.$queryRaw<
      Array<{ mapping_status: string; count: bigint }>
    >(Prisma.sql`SELECT mapping_status, COUNT(*) AS count FROM v0.brand_mappings GROUP BY mapping_status`)

    const brandStats = await getDinamikBrandMatchStats()

    const summary: BrandAliasSummary = {
      total: Number(summaryResult.find(r => r.mapping_status !== '__total__') ? 0 : 0),
      approved: Number(summaryResult.find(r => r.mapping_status === 'APPROVED')?.count ?? 0),
      pending: Number(summaryResult.find(r => r.mapping_status === 'PENDING')?.count ?? 0),
      rejected: Number(summaryResult.find(r => r.mapping_status === 'REJECTED')?.count ?? 0),
      ignored: Number(summaryResult.find(r => r.mapping_status === 'IGNORED')?.count ?? 0),
      unmatchedBrands: brandStats.unmatchedBrands,
    }
    summary.total = summary.approved + summary.pending + summary.rejected + summary.ignored

    return {
      rows: rows.map(r => ({
        id: r.id,
        dinamikBrand: r.dinamik_brand ?? '',
        normalizedName: r.brand ?? '',
        parcatedarikManufacturerId: r.ptdrk_brands_id,
        parcatedarikManufacturerName: r.manufacturer_name ?? '',
        mappingStatus: r.mapping_status,
        matchMethod: r.match_method,
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
      Prisma.sql`UPDATE v0.brand_mappings
        SET mapping_status = 'APPROVED'
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
      Prisma.sql`UPDATE v0.brand_mappings
        SET mapping_status = 'REJECTED'
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
      Prisma.sql`UPDATE v0.brand_mappings
        SET mapping_status = 'IGNORED'
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
}): Promise<{ success: boolean; message: string }> {
  await requireAdminAuth()

  try {
    const manufacturer = await db.$queryRaw<
      Array<{ id: number; name: string }>
    >(Prisma.sql`SELECT id, name FROM v0.ptdrk_brands WHERE id = ${input.parcatedarikManufacturerId}`)

    if (!manufacturer || manufacturer.length === 0) {
      return { success: false, message: 'Üretici bulunamadı.' }
    }

    const mfrName = manufacturer[0].name
    const normalized = normalizeModel(mfrName) || ''

    await db.$executeRaw(
      Prisma.sql`
        WITH canonical AS (
          INSERT INTO v0.brand_list (brand)
          VALUES (${normalized})
          ON CONFLICT (brand) DO UPDATE SET brand = ${normalized}
          RETURNING id
        )
        UPDATE v0.brand_mappings m
        SET
          ptdrk_brands_id = ${input.parcatedarikManufacturerId},
          brand_list_id = (SELECT id FROM canonical),
          match_method = 'MANUAL',
          mapping_status = 'APPROVED'
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
}): Promise<{ success: boolean; message: string }> {
  await requireAdminAuth()

  const trimmedBrand = input.dinamikBrand.trim()
  if (!trimmedBrand) {
    return { success: false, message: 'Dinamik marka adı boş olamaz.' }
  }

  try {
    const manufacturer = await db.$queryRaw<
      Array<{ id: number; name: string }>
    >(Prisma.sql`SELECT id, name FROM v0.ptdrk_brands WHERE id = ${input.parcatedarikManufacturerId}`)

    if (!manufacturer || manufacturer.length === 0) {
      return { success: false, message: 'Üretici bulunamadı.' }
    }

    const normalized = normalizeModel(manufacturer[0].name) || ''

    const dnbrdId = await resolveDbrandsIdByBrand(trimmedBrand)
    if (dnbrdId == null) {
      return { success: false, message: 'Dinamik marka kaydı oluşturulamadı.' }
    }

    await db.$executeRaw(
      Prisma.sql`
        WITH canonical AS (
          INSERT INTO v0.brand_list (brand)
          VALUES (${normalized})
          ON CONFLICT (brand) DO UPDATE SET brand = ${normalized}
          RETURNING id
        )
        INSERT INTO v0.brand_mappings (
          brand_list_id, dnmk_brands_id, ptdrk_brands_id,
          mapping_status, match_method
        )
        SELECT (SELECT id FROM canonical), ${dnbrdId}, ${input.parcatedarikManufacturerId}, 'APPROVED', 'MANUAL'
        ON CONFLICT (dnmk_brands_id, ptdrk_brands_id)
        DO UPDATE SET
          mapping_status = 'APPROVED',
          match_method = 'MANUAL',
          brand_list_id = (SELECT id FROM v0.brand_list WHERE brand = ${normalized})`
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
      Prisma.sql`DELETE FROM v0.brand_mappings WHERE id = ${input.id}`
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
      SELECT id, name FROM v0.ptdrk_brands
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
}): Promise<{ success: boolean; message: string; approved: number }> {
  await requireAdminAuth()

  const ids = input.ids.slice(0, 500)
  if (ids.length === 0) {
    return { success: false, message: 'En az bir ID gerekli.', approved: 0 }
  }

  try {
    const result = await db.$executeRaw(
      Prisma.sql`UPDATE v0.brand_mappings
        SET mapping_status = 'APPROVED'
        WHERE id IN (${Prisma.join(ids)})
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
    >(Prisma.sql`SELECT mapping_status, COUNT(*) AS count FROM v0.brand_mappings GROUP BY mapping_status`)

    const brandStats = await getDinamikBrandMatchStats()

    const statusMap = Object.fromEntries(byStatus.map(r => [r.mapping_status, Number(r.count)]))

    return {
      totalAliases: Object.values(statusMap).reduce((a, b) => a + b, 0),
      approved: statusMap['APPROVED'] ?? 0,
      pending: statusMap['PENDING'] ?? 0,
      rejected: statusMap['REJECTED'] ?? 0,
      ignored: statusMap['IGNORED'] ?? 0,
      totalDinamikBrands: brandStats.totalDinamikBrands,
      totalPcManufacturers: brandStats.totalPcManufacturers,
      matchedBrands: brandStats.matchedBrands,
      unmatchedBrands: brandStats.unmatchedBrands,
    }
  } catch (error) {
    console.error('[getDinamikParcaBrandAliasStats] Error:', error)
    return {
      totalAliases: 0, approved: 0, pending: 0, rejected: 0, ignored: 0,
      totalDinamikBrands: 0, totalPcManufacturers: 0, matchedBrands: 0, unmatchedBrands: 0
    }
  }
}
