/**
 * Generate Dinamik-ParcaTedarik Brand Aliases
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'
import { resolveDbrandsIdsByBrand } from '../lib/admin/dbrands-id'
import { normalizeModel, normalizeBrandName } from '../lib/matching/code-normalization'

const DRY_RUN = process.env.APPLY !== 'true'
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '500', 10)

type MatchMethod = 'EXACT_NORMALIZED' | 'CASE_INSENSITIVE' | 'NORMALIZED_BRAND_NAME'

interface AliasRow {
  brand: string
  dbrands_id: bigint
  normalized: string
  ptbrands_id: number
  mapping_status: string
  confidence: number
  match_method: string
}

function confidenceForMethod(method: MatchMethod): number {
  switch (method) {
    case 'EXACT_NORMALIZED': return 0.95
    case 'CASE_INSENSITIVE': return 0.90
    case 'NORMALIZED_BRAND_NAME': return 0.85
  }
}

async function main() {
  console.log('[generate-brand-aliases] Dinamik-ParcaTedarik Brand Alias Generation')
  console.log(`[generate-brand-aliases] MODE       = ${DRY_RUN ? 'DRY_RUN' : 'APPLY'}`)
  console.log(`[generate-brand-aliases] LIMIT      = ${LIMIT ?? 'none'}`)
  console.log(`[generate-brand-aliases] BATCH_SIZE = ${BATCH_SIZE}`)
  console.log()

  console.log('[generate-brand-aliases] Loading Dinamik brands...')
  const limitClause = LIMIT ? Prisma.sql`LIMIT ${LIMIT}` : Prisma.sql``
  const dinamikBrands = await db.$queryRaw<
    Array<{ brand: string }>
  >(Prisma.sql`
    SELECT DISTINCT db.brand
    FROM v0.dproducts d
    INNER JOIN v0.dbrands db ON db.id = d.dbrands_id
    WHERE db.brand IS NOT NULL
      AND BTRIM(db.brand) <> ''
    ORDER BY db.brand ASC
    ${limitClause}
  `)

  console.log(`[generate-brand-aliases] Loaded ${dinamikBrands.length} distinct Dinamik brands`)

  console.log('[generate-brand-aliases] Loading ParcaTedarik manufacturers...')
  const manufacturers = await db.$queryRaw<
    Array<{ id: number; name: string }>
  >(Prisma.sql`SELECT id, name FROM v0.ptbrands ORDER BY id`)

  console.log(`[generate-brand-aliases] Loaded ${manufacturers.length} manufacturers`)

  const exactNormMap = new Map<string, { id: number; name: string }[]>()
  const caseInsensitiveMap = new Map<string, { id: number; name: string }[]>()
  const brandNameMap = new Map<string, { id: number; name: string }[]>()

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

  console.log('[generate-brand-aliases] Loading existing brand aliases...')
  const existingAliases = await db.$queryRaw<
    Array<{ dbrands_id: bigint; ptbrands_id: number }>
  >(Prisma.sql`
    SELECT dbrands_id, ptbrands_id
    FROM v0.dbrands_match
    WHERE dbrands_id IS NOT NULL
  `)

  const existingKeys = new Set<string>()
  for (const ea of existingAliases) {
    existingKeys.add(`${ea.dbrands_id}::${ea.ptbrands_id}`)
  }
  console.log(`[generate-brand-aliases] ${existingKeys.size} existing aliases`)

  console.log('[generate-brand-aliases] Resolving dbrands ids...')
  const brandIdByName = await resolveDbrandsIdsByBrand(
    dinamikBrands.map((row) => row.brand)
  )

  console.log('[generate-brand-aliases] Matching brands to manufacturers...')
  const aliasesToInsert: AliasRow[] = []
  const stats = {
    scanned: 0,
    matched_norm: 0,
    matched_ci: 0,
    matched_bn: 0,
    no_match: 0,
    multi_match: 0,
    already_exists: 0
  }

  for (const { brand: dinamikBrand } of dinamikBrands) {
    stats.scanned++
    const trimmedBrand = dinamikBrand.trim()
    if (!trimmedBrand) continue

    const normDinamikKey = normalizeModel(trimmedBrand)
    const ciDinamikKey = trimmedBrand.toLowerCase()
    const bnDinamikKey = normalizeBrandName(trimmedBrand)

    const matchedManufacturers: Array<{
      id: number
      name: string
      method: MatchMethod
      confidence: number
    }> = []

    if (normDinamikKey && exactNormMap.has(normDinamikKey)) {
      const matches = exactNormMap.get(normDinamikKey)!
      for (const m of matches) {
        matchedManufacturers.push({
          id: m.id,
          name: m.name,
          method: 'EXACT_NORMALIZED',
          confidence: confidenceForMethod('EXACT_NORMALIZED')
        })
      }
    }

    if (matchedManufacturers.length === 0 && ciDinamikKey && caseInsensitiveMap.has(ciDinamikKey)) {
      const matches = caseInsensitiveMap.get(ciDinamikKey)!
      for (const m of matches) {
        matchedManufacturers.push({
          id: m.id,
          name: m.name,
          method: 'CASE_INSENSITIVE',
          confidence: confidenceForMethod('CASE_INSENSITIVE')
        })
      }
    }

    if (matchedManufacturers.length === 0 && bnDinamikKey && brandNameMap.has(bnDinamikKey)) {
      const matches = brandNameMap.get(bnDinamikKey)!
      for (const m of matches) {
        matchedManufacturers.push({
          id: m.id,
          name: m.name,
          method: 'NORMALIZED_BRAND_NAME',
          confidence: confidenceForMethod('NORMALIZED_BRAND_NAME')
        })
      }
    }

    if (matchedManufacturers.length === 0) {
      stats.no_match++
      continue
    }

    if (matchedManufacturers.length > 1) {
      stats.multi_match += matchedManufacturers.length
    }

    const dbrandsId = brandIdByName.get(trimmedBrand.toLowerCase())
    if (dbrandsId == null) continue

    for (const mm of matchedManufacturers) {
      const key = `${dbrandsId}::${mm.id}`
      if (existingKeys.has(key)) {
        stats.already_exists++
        continue
      }

      const normalized = mm.name

      aliasesToInsert.push({
        brand: trimmedBrand,
        dbrands_id: dbrandsId,
        normalized,
        ptbrands_id: mm.id,
        mapping_status: 'PENDING',
        confidence: mm.confidence,
        match_method: mm.method
      })

      existingKeys.add(key)

      switch (mm.method) {
        case 'EXACT_NORMALIZED': stats.matched_norm++; break
        case 'CASE_INSENSITIVE': stats.matched_ci++; break
        case 'NORMALIZED_BRAND_NAME': stats.matched_bn++; break
      }
    }
  }

  console.log()
  console.log('=== Generation Summary ===')
  console.log(`  Dinamik brands scanned:          ${stats.scanned}`)
  console.log(`  Matched (EXACT_NORMALIZED):      ${stats.matched_norm}`)
  console.log(`  Matched (CASE_INSENSITIVE):      ${stats.matched_ci}`)
  console.log(`  Matched (NORMALIZED_BRAND_NAME): ${stats.matched_bn}`)
  console.log(`  No match found:                  ${stats.no_match}`)
  console.log(`  Multiple-match entries:          ${stats.multi_match}`)
  console.log(`  Already existed:                 ${stats.already_exists}`)
  console.log(`  Aliases to insert:               ${aliasesToInsert.length}`)

  console.log()
  console.log('=== Sample Aliases (first 30) ===')
  for (const alias of aliasesToInsert.slice(0, 30)) {
    console.log(
      `  "${alias.brand}" (norm:${alias.normalized}) → ` +
      `mfr_id=${alias.ptbrands_id} ` +
      `method=${alias.match_method}`
    )
  }

  console.log()
  console.log('=== Unmatched Dinamik Brands ===')
  const matchedBrands = new Set(aliasesToInsert.map((a) => a.brand))
  const existingBrandNames = new Set(
    (
      await db.$queryRaw<Array<{ brand: string }>>(Prisma.sql`
        SELECT db.brand
        FROM v0.dbrands_match a
        INNER JOIN v0.dbrands db ON db.id = a.dbrands_id
      `)
    ).map((row) => row.brand.trim().toLowerCase())
  )
  const unmatchedBrands = dinamikBrands
    .map((b) => b.brand.trim())
    .filter(
      (b) =>
        b &&
        !matchedBrands.has(b) &&
        !existingBrandNames.has(b.toLowerCase())
    )
  for (const ub of unmatchedBrands.slice(0, 50)) {
    const normKey = normalizeModel(ub) || ''
    const ciKey = ub.toLowerCase()
    const bnKey = normalizeBrandName(ub) || ''
    console.log(`  "${ub}" norm="${normKey}" ci="${ciKey}" bn="${bnKey}"`)
  }
  if (unmatchedBrands.length > 50) {
    console.log(`  ... and ${unmatchedBrands.length - 50} more`)
  }

  if (DRY_RUN) {
    console.log()
    console.log('[generate-brand-aliases] DRY_RUN mode - no database writes performed.')
    console.log('[generate-brand-aliases] Re-run with APPLY=true to apply changes.')
    await db.$disconnect()
    return
  }

  console.log()
  console.log('[generate-brand-aliases] Inserting aliases...')
  let totalInserted = 0

  for (let i = 0; i < aliasesToInsert.length; i += BATCH_SIZE) {
    const batch = aliasesToInsert.slice(i, i + BATCH_SIZE)
    try {
      const result = await db.$executeRaw(Prisma.sql`
        INSERT INTO v0.dbrands_match (
          dbrands_id, normalized, ptbrands_id,
          mapping_status, match_method
        )
        SELECT v.dbrands_id, v.normalized, v.ptbrands_id, v.mapping_status, v.match_method
        FROM (VALUES ${Prisma.join(
          batch.map(
            (a) =>
              Prisma.sql`(${a.dbrands_id}, ${a.normalized}, ${a.ptbrands_id}, ${a.mapping_status}, ${a.match_method})`
          )
        )}) AS v(dbrands_id, normalized, ptbrands_id, mapping_status, match_method)
        ON CONFLICT (dbrands_id, ptbrands_id) DO NOTHING
      `)
      totalInserted += Number(result)
      console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: inserted ${result} rows`)
    } catch (error) {
      console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: error inserting`, error)
    }
  }

  console.log()
  console.log(`[generate-brand-aliases] Total aliases inserted: ${totalInserted}`)

  console.log()
  console.log('=== Validation ===')

  const totalAliases = await db.$queryRaw<
    Array<{ count: bigint }>
  >(Prisma.sql`SELECT COUNT(*) AS count FROM v0.dbrands_match`)
  console.log(`  Total brand aliases in table: ${totalAliases[0].count}`)

  const byStatus = await db.$queryRaw<
    Array<{ mapping_status: string; count: bigint }>
  >(Prisma.sql`
    SELECT mapping_status, COUNT(*) AS count
    FROM v0.dbrands_match
    GROUP BY mapping_status
    ORDER BY count DESC
  `)
  for (const row of byStatus) {
    console.log(`  ${row.mapping_status}: ${row.count}`)
  }

  const byMethod = await db.$queryRaw<
    Array<{ match_method: string; count: bigint }>
  >(Prisma.sql`
    SELECT match_method, COUNT(*) AS count
    FROM v0.dbrands_match
    GROUP BY match_method
    ORDER BY count DESC
  `)
  for (const row of byMethod) {
    console.log(`  ${row.match_method}: ${row.count}`)
  }

  console.log()
  console.log('[generate-brand-aliases] Done.')
  await db.$disconnect()
}

main().catch((err) => {
  console.error('[generate-brand-aliases] Fatal error:', err)
  process.exit(1)
})
