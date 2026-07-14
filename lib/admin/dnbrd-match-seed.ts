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
      (SELECT COUNT(*)::int FROM catalog.brand_mappings) AS match_total,
      (SELECT COUNT(*)::int FROM catalog.supplier_dinamik_brands) AS dnbrd_total,
      (SELECT COUNT(*)::int FROM catalog.ptdrk_brands) AS manufacturer_total,
      (SELECT COUNT(*)::int FROM catalog.brand_mappings WHERE dinamik_brand_id IS NOT NULL) AS with_dinamik_brand,
      (SELECT COUNT(*)::int FROM catalog.brand_mappings WHERE ptdrk_brand_id IS NOT NULL) AS with_manufacturer,
      (SELECT COUNT(*)::int FROM catalog.brand_mappings WHERE dinamik_brand_id IS NULL AND ptdrk_brand_id IS NOT NULL) AS pt_only_rows,
      (SELECT COUNT(*)::int FROM catalog.brand_mappings WHERE dinamik_brand_id IS NOT NULL AND ptdrk_brand_id IS NULL) AS dinamik_stub_rows,
      (SELECT COUNT(*)::int FROM catalog.brand_mappings WHERE dinamik_brand_id IS NOT NULL AND ptdrk_brand_id IS NOT NULL) AS paired_rows,
      (
        SELECT COUNT(*)::int FROM catalog.ptdrk_brands m
        WHERE NOT EXISTS (SELECT 1 FROM catalog.brand_mappings a WHERE a.ptdrk_brand_id = m.id)
      ) AS manufacturers_missing,
      (
        SELECT COUNT(*)::int FROM catalog.supplier_dinamik_brands d
        WHERE NOT EXISTS (SELECT 1 FROM catalog.brand_mappings a WHERE a.dinamik_brand_id = d.id)
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
    FROM catalog.supplier_dinamik_brands d
    WHERE NOT EXISTS (
      SELECT 1
      FROM catalog.brand_mappings m
      WHERE m.dinamik_brand_id = d.id
    )
  `)
  const missing = row?.count ?? 0
  if (dryRun || missing === 0) return missing

  const inserted = Number(
    await db.$executeRaw(Prisma.sql`
      INSERT INTO catalog.brand_mappings (
        brand_id, dinamik_brand_id, ptdrk_brand_id, mapping_status, match_method
      )
      SELECT cb.id, d.id, NULL, 'PENDING', NULL
      FROM catalog.supplier_dinamik_brands d
      JOIN catalog.brands cb ON cb.brand = UPPER(BTRIM(d.brand))
      WHERE NOT EXISTS (
        SELECT 1
        FROM catalog.brand_mappings m
        WHERE m.dinamik_brand_id = d.id
      )
    `)
  )

  // For brands without a canonical entry, create one then insert mapping
  const remaining = await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.brands (brand, logo_url)
    SELECT UPPER(BTRIM(d.brand)), d.logo_url
    FROM catalog.supplier_dinamik_brands d
    WHERE NOT EXISTS (
      SELECT 1 FROM catalog.brand_mappings m WHERE m.dinamik_brand_id = d.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM catalog.brands cb WHERE cb.brand = UPPER(BTRIM(d.brand))
    )
    ON CONFLICT (brand) DO NOTHING
  `)

  // Insert mappings for those remaining rows
  if (Number(remaining) > 0) {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO catalog.brand_mappings (
        brand_id, dinamik_brand_id, ptdrk_brand_id, mapping_status, match_method
      )
      SELECT cb.id, d.id, NULL, 'PENDING', NULL
      FROM catalog.supplier_dinamik_brands d
      JOIN catalog.brands cb ON cb.brand = UPPER(BTRIM(d.brand))
      WHERE NOT EXISTS (
        SELECT 1
        FROM catalog.brand_mappings m
        WHERE m.dinamik_brand_id = d.id
      )
    `)
  }

  return missing
}

async function countPtOnlyInserts(dryRun: boolean): Promise<number> {
  const [row] = await db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM catalog.ptdrk_brands m
    WHERE NOT EXISTS (
      SELECT 1 FROM catalog.brand_mappings a WHERE a.ptdrk_brand_id = m.id
    )
  `)
  const missing = row?.count ?? 0
  if (dryRun || missing === 0) return missing

  const inserted = Number(
    await db.$executeRaw(Prisma.sql`
      INSERT INTO catalog.brand_mappings (
        brand_id, dinamik_brand_id, ptdrk_brand_id, mapping_status, match_method
      )
      SELECT cb.id, NULL, pt.id, 'PENDING', NULL
      FROM catalog.ptdrk_brands pt
      JOIN catalog.brands cb ON cb.brand = UPPER(BTRIM(pt.name))
      WHERE NOT EXISTS (
        SELECT 1 FROM catalog.brand_mappings m WHERE m.ptdrk_brand_id = pt.id
      )
    `)
  )

  // For manufacturers without a canonical entry, create one then insert mapping
  const remaining = await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.brands (brand)
    SELECT UPPER(BTRIM(pt.name))
    FROM catalog.ptdrk_brands pt
    WHERE NOT EXISTS (
      SELECT 1 FROM catalog.brand_mappings m WHERE m.ptdrk_brand_id = pt.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM catalog.brands cb WHERE cb.brand = UPPER(BTRIM(pt.name))
    )
    ON CONFLICT (brand) DO NOTHING
  `)

  if (Number(remaining) > 0) {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO catalog.brand_mappings (
        brand_id, dinamik_brand_id, ptdrk_brand_id, mapping_status, match_method
      )
      SELECT cb.id, NULL, pt.id, 'PENDING', NULL
      FROM catalog.ptdrk_brands pt
      JOIN catalog.brands cb ON cb.brand = UPPER(BTRIM(pt.name))
      WHERE NOT EXISTS (
        SELECT 1 FROM catalog.brand_mappings m WHERE m.ptdrk_brand_id = pt.id
      )
    `)
  }

  return missing
}

async function seedAutoMatchedPairs(dryRun: boolean): Promise<number> {
  const dinamikBrands = await db.$queryRaw<Array<{ brand: string }>>(Prisma.sql`
    SELECT DISTINCT BTRIM(brand) AS brand
    FROM catalog.supplier_dinamik_brands
    WHERE brand IS NOT NULL AND BTRIM(brand) <> ''
    ORDER BY brand ASC
  `)

  const manufacturers = await db.$queryRaw<Array<{ id: number; name: string }>>(
    Prisma.sql`SELECT id, name FROM catalog.ptdrk_brands ORDER BY id`
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
    Array<{ dinamik_brand_id: bigint | null; ptdrk_brand_id: number | null }>
  >(Prisma.sql`
    SELECT dinamik_brand_id, ptdrk_brand_id
    FROM catalog.brand_mappings
    WHERE dinamik_brand_id IS NOT NULL AND ptdrk_brand_id IS NOT NULL
  `)
  for (const row of existing) {
    if (row.dinamik_brand_id != null && row.ptdrk_brand_id) {
      existingKeys.add(`${row.dinamik_brand_id}::${row.ptdrk_brand_id}`)
    }
  }

  const toInsert: Array<{
    dinamik_brand_id: bigint
    ptdrk_brand_id: number
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
        dinamik_brand_id: dnbrdId,
        ptdrk_brand_id: mm.id,
        match_method: mm.method
      })
      existingKeys.add(key)
    }
  }

  if (dryRun || toInsert.length === 0) return toInsert.length

  // Ensure canonical brands exist for all matched pairs
  const normalizedNames = Array.from(
    new Set(toInsert.map(row => {
      const brand = manufacturers.find(m => m.id === row.ptdrk_brand_id)
      return brand ? normalizeModel(brand.name) || '' : ''
    }).filter(Boolean))
  )

  if (normalizedNames.length > 0) {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO catalog.brands (brand, logo_url)
      SELECT v.name, NULL
      FROM (VALUES ${Prisma.join(normalizedNames.map(n => Prisma.sql`(${n})`))}) AS v(name)
      ON CONFLICT (brand) DO NOTHING
    `)
  }

  await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.brand_mappings (brand_id, dinamik_brand_id, ptdrk_brand_id, mapping_status, match_method)
    SELECT cb.id, v.dinamik_brand_id, v.ptdrk_brand_id, 'PENDING', v.match_method
    FROM (VALUES ${Prisma.join(
      toInsert.map(
        (row) =>
          Prisma.sql`(${row.dinamik_brand_id}, ${row.ptdrk_brand_id}, ${row.match_method})`
      )
    )}) AS v(dinamik_brand_id, ptdrk_brand_id, match_method)
    JOIN catalog.ptdrk_brands pt ON pt.id = v.ptdrk_brand_id
    JOIN catalog.brands cb ON cb.brand = UPPER(BTRIM(COALESCE(NULLIF(BTRIM(pt.name), ''), ''), ''))
    ON CONFLICT (dinamik_brand_id, ptdrk_brand_id) DO NOTHING
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
    Prisma.sql`SELECT COUNT(*)::int AS count FROM catalog.brand_mappings`
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
