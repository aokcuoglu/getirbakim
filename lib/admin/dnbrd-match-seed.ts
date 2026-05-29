import { Prisma } from '@prisma/client'
import {
  countRedundantDinamikStubs,
  countRedundantPtOnlyRows,
  removeRedundantDbrandsMatchRows,
} from '@/lib/admin/dnbrd-match-cleanup'
import { resolveDbrandsIdsByBrand } from '@/lib/admin/dnbrd-id'
import { db } from '@/lib/db'
import { normalizeBrandName, normalizeModel } from '@/lib/matching/code-normalization'

const BATCH_SIZE = 500

type MatchMethod = 'EXACT_NORMALIZED' | 'CASE_INSENSITIVE' | 'NORMALIZED_BRAND_NAME'

import type { DbrandsMatchAudit, DbrandsMatchSeedResult } from '@/lib/types/dnbrd'

export type { DbrandsMatchSeedResult } from '@/lib/types/dnbrd'

export async function auditDbrandsMatch(): Promise<DbrandsMatchAudit> {
  const [row] = await db.$queryRaw<
    Array<{
      match_total: number
      dnbrd_total: number
      manufacturer_total: number
      with_dinamik_brand: number
      with_manufacturer: number
      pt_only_rows: number
      dinamik_stub_rows: number
      paired_rows: number
      manufacturers_missing: number
      dnbrd_missing: number
    }>
  >(Prisma.sql`
    SELECT
      (SELECT COUNT(*)::int FROM v0.dnmk_ptdrk_brands) AS match_total,
      (SELECT COUNT(*)::int FROM v0.dnmk_brands) AS dnbrd_total,
      (SELECT COUNT(*)::int FROM v0.ptdrk_brands) AS manufacturer_total,
      (SELECT COUNT(*)::int FROM v0.dnmk_ptdrk_brands WHERE dnmk_brands_id IS NOT NULL) AS with_dinamik_brand,
      (SELECT COUNT(*)::int FROM v0.dnmk_ptdrk_brands WHERE ptdrk_brands_id IS NOT NULL) AS with_manufacturer,
      (SELECT COUNT(*)::int FROM v0.dnmk_ptdrk_brands WHERE dnmk_brands_id IS NULL AND ptdrk_brands_id IS NOT NULL) AS pt_only_rows,
      (SELECT COUNT(*)::int FROM v0.dnmk_ptdrk_brands WHERE dnmk_brands_id IS NOT NULL AND ptdrk_brands_id IS NULL) AS dinamik_stub_rows,
      (SELECT COUNT(*)::int FROM v0.dnmk_ptdrk_brands WHERE dnmk_brands_id IS NOT NULL AND ptdrk_brands_id IS NOT NULL) AS paired_rows,
      (
        SELECT COUNT(*)::int FROM v0.ptdrk_brands m
        WHERE NOT EXISTS (SELECT 1 FROM v0.dnmk_ptdrk_brands a WHERE a.ptdrk_brands_id = m.id)
      ) AS manufacturers_missing,
      (
        SELECT COUNT(*)::int FROM v0.dnmk_brands d
        WHERE NOT EXISTS (SELECT 1 FROM v0.dnmk_ptdrk_brands a WHERE a.dnmk_brands_id = d.id)
      ) AS dnbrd_missing
  `)

  const r = row!
  return {
    matchTotal: r.match_total,
    dnbrdTotal: r.dnbrd_total,
    manufacturerTotal: r.manufacturer_total,
    withDinamikBrand: r.with_dinamik_brand,
    withManufacturer: r.with_manufacturer,
    ptOnlyRows: r.pt_only_rows,
    dinamikStubRows: r.dinamik_stub_rows,
    pairedRows: r.paired_rows,
    manufacturersMissingFromMatch: r.manufacturers_missing,
    dnbrdMissingFromMatch: r.dnbrd_missing
  }
}

async function countDinamikStubInserts(dryRun: boolean): Promise<number> {
  const [row] = await db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM v0.dnmk_brands d
    WHERE NOT EXISTS (
      SELECT 1
      FROM v0.dnmk_ptdrk_brands m
      WHERE m.dnmk_brands_id = d.id
    )
  `)
  const missing = row?.count ?? 0
  if (dryRun || missing === 0) return missing

  return Number(
    await db.$executeRaw(Prisma.sql`
      INSERT INTO v0.dnmk_ptdrk_brands (
        dnmk_brands_id, ptdrk_brands_id, normalized_brand, mapping_status, match_method
      )
      SELECT d.id, NULL, NULL, 'PENDING', NULL
      FROM v0.dnmk_brands d
      WHERE NOT EXISTS (
        SELECT 1
        FROM v0.dnmk_ptdrk_brands m
        WHERE m.dnmk_brands_id = d.id
      )
    `)
  )
}

async function countPtOnlyInserts(dryRun: boolean): Promise<number> {
  const [row] = await db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM v0.ptdrk_brands m
    WHERE NOT EXISTS (
      SELECT 1 FROM v0.dnmk_ptdrk_brands a WHERE a.ptdrk_brands_id = m.id
    )
  `)
  const missing = row?.count ?? 0
  if (dryRun || missing === 0) return missing

  return Number(
    await db.$executeRaw(Prisma.sql`
      INSERT INTO v0.dnmk_ptdrk_brands (
        dnmk_brands_id, ptdrk_brands_id, normalized_brand, mapping_status, match_method
      )
      SELECT
        NULL,
        m.id,
        m.name,
        'PENDING',
        NULL
      FROM v0.ptdrk_brands m
      WHERE NOT EXISTS (
        SELECT 1 FROM v0.dnmk_ptdrk_brands a WHERE a.ptdrk_brands_id = m.id
      )
    `)
  )
}

async function seedAutoMatchedPairs(dryRun: boolean): Promise<number> {
  const dinamikBrands = await db.$queryRaw<Array<{ brand: string }>>(Prisma.sql`
    SELECT DISTINCT BTRIM(brand) AS brand
    FROM v0.dnmk_brands
    WHERE brand IS NOT NULL AND BTRIM(brand) <> ''
    ORDER BY brand ASC
  `)

  const manufacturers = await db.$queryRaw<Array<{ id: number; name: string }>>(
    Prisma.sql`SELECT id, name FROM v0.ptdrk_brands ORDER BY id`
  )

  const exactNormMap = new Map<string, Array<{ id: number; name: string }>>()
  const caseInsensitiveMap = new Map<string, Array<{ id: number; name: string }>>()
  const brandNameMap = new Map<string, Array<{ id: number; name: string }>>()

  for (const m of manufacturers) {
    const normKey = normalizeModel(m.name)
    if (normKey) {
      if (!exactNormMap.has(normKey)) exactNormMap.set(normKey, [])
      exactNormMap.get(normKey)!.push(m)
    }
    const ciKey = m.name.trim().toLowerCase()
    if (ciKey) {
      if (!caseInsensitiveMap.has(ciKey)) caseInsensitiveMap.set(ciKey, [])
      caseInsensitiveMap.get(ciKey)!.push(m)
    }
    const bnKey = normalizeBrandName(m.name)
    if (bnKey) {
      if (!brandNameMap.has(bnKey)) brandNameMap.set(bnKey, [])
      brandNameMap.get(bnKey)!.push(m)
    }
  }

  const existingKeys = new Set<string>()
  const existing = await db.$queryRaw<
    Array<{ dnmk_brands_id: bigint | null; ptdrk_brands_id: number | null }>
  >(Prisma.sql`
    SELECT dnmk_brands_id, ptdrk_brands_id
    FROM v0.dnmk_ptdrk_brands
    WHERE dnmk_brands_id IS NOT NULL AND ptdrk_brands_id IS NOT NULL
  `)
  for (const row of existing) {
    if (row.dnmk_brands_id != null && row.ptdrk_brands_id) {
      existingKeys.add(`${row.dnmk_brands_id}::${row.ptdrk_brands_id}`)
    }
  }

  const toInsert: Array<{
    dnmk_brands_id: bigint
    normalized_brand: string
    ptdrk_brands_id: number
    match_method: MatchMethod
  }> = []

  const brandIdByName = await resolveDbrandsIdsByBrand(
    dinamikBrands.map((row) => row.brand)
  )

  for (const { brand: dinamikBrand } of dinamikBrands) {
    const trimmedBrand = dinamikBrand.trim()
    if (!trimmedBrand) continue

    const normDinamikKey = normalizeModel(trimmedBrand)
    const ciDinamikKey = trimmedBrand.toLowerCase()
    const bnDinamikKey = normalizeBrandName(trimmedBrand)

    const matched: Array<{ id: number; name: string; method: MatchMethod }> = []

    if (normDinamikKey && exactNormMap.has(normDinamikKey)) {
      for (const m of exactNormMap.get(normDinamikKey)!) {
        matched.push({ ...m, method: 'EXACT_NORMALIZED' })
      }
    } else if (ciDinamikKey && caseInsensitiveMap.has(ciDinamikKey)) {
      for (const m of caseInsensitiveMap.get(ciDinamikKey)!) {
        matched.push({ ...m, method: 'CASE_INSENSITIVE' })
      }
    } else if (bnDinamikKey && brandNameMap.has(bnDinamikKey)) {
      for (const m of brandNameMap.get(bnDinamikKey)!) {
        matched.push({ ...m, method: 'NORMALIZED_BRAND_NAME' })
      }
    }

    const dnbrdId = brandIdByName.get(trimmedBrand.toLowerCase())
    if (dnbrdId == null) continue

    for (const mm of matched) {
      const key = `${dnbrdId}::${mm.id}`
      if (existingKeys.has(key)) continue
      toInsert.push({
        dnmk_brands_id: dnbrdId,
        normalized_brand: mm.name,
        ptdrk_brands_id: mm.id,
        match_method: mm.method
      })
      existingKeys.add(key)
    }
  }

  if (dryRun || toInsert.length === 0) return toInsert.length

  await db.$executeRaw(Prisma.sql`
    INSERT INTO v0.dnmk_ptdrk_brands (dnmk_brands_id, normalized_brand, ptdrk_brands_id, mapping_status, match_method)
    SELECT v.dnmk_brands_id, v.normalized_brand, v.ptdrk_brands_id, 'PENDING', v.match_method
    FROM (VALUES ${Prisma.join(
      toInsert.map(
        (row) =>
          Prisma.sql`(${row.dnmk_brands_id}, ${row.normalized_brand}, ${row.ptdrk_brands_id}, ${row.match_method})`
      )
    )}) AS v(dnmk_brands_id, normalized_brand, ptdrk_brands_id, match_method)
    ON CONFLICT (dnmk_brands_id, ptdrk_brands_id) DO NOTHING
  `)

  return toInsert.length
}

export async function seedDbrandsMatchWorkspace(options?: {
  dryRun?: boolean
  runAutoMatch?: boolean
}): Promise<DbrandsMatchSeedResult> {
  const dryRun = options?.dryRun !== false
  const runAutoMatch = options?.runAutoMatch !== false

  let removedRedundantStubs = 0
  let removedRedundantPtOnly = 0
  if (dryRun) {
    removedRedundantStubs = await countRedundantDinamikStubs()
    removedRedundantPtOnly = await countRedundantPtOnlyRows()
  } else {
    const removed = await removeRedundantDbrandsMatchRows()
    removedRedundantStubs = removed.removedDinamikStubs
    removedRedundantPtOnly = removed.removedPtOnlyRows
  }

  const insertedDinamikStubs = await countDinamikStubInserts(dryRun)
  const insertedPtOnly = await countPtOnlyInserts(dryRun)
  const insertedAutoMatched = runAutoMatch
    ? await seedAutoMatchedPairs(dryRun)
    : 0

  if (!dryRun) {
    const removedAfterMatch = await removeRedundantDbrandsMatchRows()
    removedRedundantStubs += removedAfterMatch.removedDinamikStubs
    removedRedundantPtOnly += removedAfterMatch.removedPtOnlyRows
  }

  const [row] = await db.$queryRaw<Array<{ count: number }>>(
    Prisma.sql`SELECT COUNT(*)::int AS count FROM v0.dnmk_ptdrk_brands`
  )

  return {
    dryRun,
    removedRedundantStubs,
    removedRedundantPtOnly,
    insertedDinamikStubs,
    insertedPtOnly,
    insertedAutoMatched,
    matchTotalAfter: dryRun
      ? (row?.count ?? 0) +
        insertedDinamikStubs +
        insertedPtOnly +
        insertedAutoMatched
      : row?.count ?? 0
  }
}
