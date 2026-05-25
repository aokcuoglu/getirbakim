import { Prisma } from '@prisma/client'
import { resolveDbrandsIdsByBrand } from '@/lib/admin/dbrands-id'
import { db } from '@/lib/db'
import { normalizeBrandName, normalizeModel } from '@/lib/matching/code-normalization'

const BATCH_SIZE = 500

type MatchMethod = 'EXACT_NORMALIZED' | 'CASE_INSENSITIVE' | 'NORMALIZED_BRAND_NAME'

import type { DbrandsMatchAudit, DbrandsMatchSeedResult } from '@/lib/types/dbrands'

export type { DbrandsMatchSeedResult } from '@/lib/types/dbrands'

export async function auditDbrandsMatch(): Promise<DbrandsMatchAudit> {
  const [row] = await db.$queryRaw<
    Array<{
      match_total: number
      dbrands_total: number
      manufacturer_total: number
      with_dinamik_brand: number
      with_manufacturer: number
      pt_only_rows: number
      dinamik_stub_rows: number
      paired_rows: number
      manufacturers_missing: number
      dbrands_missing: number
    }>
  >(Prisma.sql`
    SELECT
      (SELECT COUNT(*)::int FROM v0.dbrands_match) AS match_total,
      (SELECT COUNT(*)::int FROM v0.dbrands) AS dbrands_total,
      (SELECT COUNT(*)::int FROM v0.ptbrands) AS manufacturer_total,
      (SELECT COUNT(*)::int FROM v0.dbrands_match WHERE dbrands_id IS NOT NULL) AS with_dinamik_brand,
      (SELECT COUNT(*)::int FROM v0.dbrands_match WHERE ptbrands_id IS NOT NULL) AS with_manufacturer,
      (SELECT COUNT(*)::int FROM v0.dbrands_match WHERE dbrands_id IS NULL AND ptbrands_id IS NOT NULL) AS pt_only_rows,
      (SELECT COUNT(*)::int FROM v0.dbrands_match WHERE dbrands_id IS NOT NULL AND ptbrands_id IS NULL) AS dinamik_stub_rows,
      (SELECT COUNT(*)::int FROM v0.dbrands_match WHERE dbrands_id IS NOT NULL AND ptbrands_id IS NOT NULL) AS paired_rows,
      (
        SELECT COUNT(*)::int FROM v0.ptbrands m
        WHERE NOT EXISTS (SELECT 1 FROM v0.dbrands_match a WHERE a.ptbrands_id = m.id)
      ) AS manufacturers_missing,
      (
        SELECT COUNT(*)::int FROM v0.dbrands d
        WHERE NOT EXISTS (SELECT 1 FROM v0.dbrands_match a WHERE a.dbrands_id = d.id)
      ) AS dbrands_missing
  `)

  const r = row!
  return {
    matchTotal: r.match_total,
    dbrandsTotal: r.dbrands_total,
    manufacturerTotal: r.manufacturer_total,
    withDinamikBrand: r.with_dinamik_brand,
    withManufacturer: r.with_manufacturer,
    ptOnlyRows: r.pt_only_rows,
    dinamikStubRows: r.dinamik_stub_rows,
    pairedRows: r.paired_rows,
    manufacturersMissingFromMatch: r.manufacturers_missing,
    dbrandsMissingFromMatch: r.dbrands_missing
  }
}

async function countDinamikStubInserts(dryRun: boolean): Promise<number> {
  const [row] = await db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM v0.dbrands d
    WHERE NOT EXISTS (
      SELECT 1
      FROM v0.dbrands_match m
      WHERE m.dbrands_id = d.id
    )
  `)
  const missing = row?.count ?? 0
  if (dryRun || missing === 0) return missing

  return Number(
    await db.$executeRaw(Prisma.sql`
      INSERT INTO v0.dbrands_match (
        dbrands_id, ptbrands_id, normalized, mapping_status, match_method
      )
      SELECT d.id, NULL, NULL, 'PENDING', NULL
      FROM v0.dbrands d
      WHERE NOT EXISTS (
        SELECT 1
        FROM v0.dbrands_match m
        WHERE m.dbrands_id = d.id
      )
    `)
  )
}

async function countPtOnlyInserts(dryRun: boolean): Promise<number> {
  const [row] = await db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM v0.ptbrands m
    WHERE NOT EXISTS (
      SELECT 1 FROM v0.dbrands_match a WHERE a.ptbrands_id = m.id
    )
  `)
  const missing = row?.count ?? 0
  if (dryRun || missing === 0) return missing

  return Number(
    await db.$executeRaw(Prisma.sql`
      INSERT INTO v0.dbrands_match (
        dbrands_id, ptbrands_id, normalized, mapping_status, match_method
      )
      SELECT
        NULL,
        m.id,
        m.name,
        'PENDING',
        NULL
      FROM v0.ptbrands m
      WHERE NOT EXISTS (
        SELECT 1 FROM v0.dbrands_match a WHERE a.ptbrands_id = m.id
      )
    `)
  )
}

async function seedAutoMatchedPairs(dryRun: boolean): Promise<number> {
  const dinamikBrands = await db.$queryRaw<Array<{ brand: string }>>(Prisma.sql`
    SELECT DISTINCT BTRIM(brand) AS brand
    FROM v0.dbrands
    WHERE brand IS NOT NULL AND BTRIM(brand) <> ''
    ORDER BY brand ASC
  `)

  const manufacturers = await db.$queryRaw<Array<{ id: number; name: string }>>(
    Prisma.sql`SELECT id, name FROM v0.ptbrands ORDER BY id`
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
    Array<{ dbrands_id: bigint | null; ptbrands_id: number | null }>
  >(Prisma.sql`
    SELECT dbrands_id, ptbrands_id
    FROM v0.dbrands_match
    WHERE dbrands_id IS NOT NULL AND ptbrands_id IS NOT NULL
  `)
  for (const row of existing) {
    if (row.dbrands_id != null && row.ptbrands_id) {
      existingKeys.add(`${row.dbrands_id}::${row.ptbrands_id}`)
    }
  }

  const toInsert: Array<{
    dbrands_id: bigint
    normalized: string
    ptbrands_id: number
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

    const dbrandsId = brandIdByName.get(trimmedBrand.toLowerCase())
    if (dbrandsId == null) continue

    for (const mm of matched) {
      const key = `${dbrandsId}::${mm.id}`
      if (existingKeys.has(key)) continue
      toInsert.push({
        dbrands_id: dbrandsId,
        normalized: mm.name,
        ptbrands_id: mm.id,
        match_method: mm.method
      })
      existingKeys.add(key)
    }
  }

  if (dryRun || toInsert.length === 0) return toInsert.length

  await db.$executeRaw(Prisma.sql`
    INSERT INTO v0.dbrands_match (dbrands_id, normalized, ptbrands_id, mapping_status, match_method)
    SELECT v.dbrands_id, v.normalized, v.ptbrands_id, 'PENDING', v.match_method
    FROM (VALUES ${Prisma.join(
      toInsert.map(
        (row) =>
          Prisma.sql`(${row.dbrands_id}, ${row.normalized}, ${row.ptbrands_id}, ${row.match_method})`
      )
    )}) AS v(dbrands_id, normalized, ptbrands_id, match_method)
    ON CONFLICT (dbrands_id, ptbrands_id) DO NOTHING
  `)

  return toInsert.length
}

async function removeRedundantDinamikStubs(dryRun: boolean): Promise<number> {
  const [row] = await db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM v0.dbrands_match a
    WHERE a.ptbrands_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM v0.dbrands_match b
        WHERE b.dbrands_id = a.dbrands_id
          AND b.ptbrands_id IS NOT NULL
          AND b.id <> a.id
      )
  `)
  const redundant = row?.count ?? 0
  if (dryRun || redundant === 0) return redundant

  return Number(
    await db.$executeRaw(Prisma.sql`
      DELETE FROM v0.dbrands_match a
      WHERE a.ptbrands_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM v0.dbrands_match b
          WHERE b.dbrands_id = a.dbrands_id
            AND b.ptbrands_id IS NOT NULL
            AND b.id <> a.id
        )
    `)
  )
}

export async function seedDbrandsMatchWorkspace(options?: {
  dryRun?: boolean
  runAutoMatch?: boolean
}): Promise<DbrandsMatchSeedResult> {
  const dryRun = options?.dryRun !== false
  const runAutoMatch = options?.runAutoMatch !== false

  const removedRedundantStubs = await removeRedundantDinamikStubs(dryRun)
  const insertedDinamikStubs = await countDinamikStubInserts(dryRun)
  const insertedPtOnly = await countPtOnlyInserts(dryRun)
  const insertedAutoMatched = runAutoMatch
    ? await seedAutoMatchedPairs(dryRun)
    : 0

  const [row] = await db.$queryRaw<Array<{ count: number }>>(
    Prisma.sql`SELECT COUNT(*)::int AS count FROM v0.dbrands_match`
  )

  return {
    dryRun,
    removedRedundantStubs,
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
