/**
 * Generate Dinamik-ParcaTedarik Model Match Candidates
 *
 * Scans Dinamik products with barcodes and matches against
 * parcatedarik.product.normalized_model to create candidate rows
 * in public.dinamik_parcatedarik_model_matches.
 *
 * Usage:
 *   DRY_RUN=true  bun scripts/generate-dinamik-parcatedarik-model-matches.ts
 *   APPLY=true     bun scripts/generate-dinamik-parcatedarik-model-matches.ts
 *
 * Optional:
 *   LIMIT=5000         Only process first N Dinamik products
 *   BATCH_SIZE=1000    Batch size for inserts
 *   STATUS=CANDIDATE   Default status for new matches
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'
import { normalizeModel } from '../lib/matching/code-normalization'

const DRY_RUN = process.env.APPLY !== 'true'
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '1000', 10)
const DEFAULT_STATUS = process.env.STATUS || 'CANDIDATE'

interface Stats {
  dinamikProductsScanned: number
  dinamikProductsWithBarcode: number
  barcodeValuesChecked: number
  exactMatchesFound: number
  uniqueMatches: number
  multipleMatches: number
  candidatesWouldInsert: number
  candidatesInserted: number
  needsReview: number
  errors: number
}

async function main() {
  console.log('[generate-matches] Dinamik-ParcaTedarik Model Match Generation')
  console.log(`[generate-matches] MODE       = ${DRY_RUN ? 'DRY_RUN' : 'APPLY'}`)
  console.log(`[generate-matches] LIMIT      = ${LIMIT ?? 'none'}`)
  console.log(`[generate-matches] BATCH_SIZE = ${BATCH_SIZE}`)
  console.log(`[generate-matches] STATUS     = ${DEFAULT_STATUS}`)
  console.log()

  const stats: Stats = {
    dinamikProductsScanned: 0,
    dinamikProductsWithBarcode: 0,
    barcodeValuesChecked: 0,
    exactMatchesFound: 0,
    uniqueMatches: 0,
    multipleMatches: 0,
    candidatesWouldInsert: 0,
    candidatesInserted: 0,
    needsReview: 0,
    errors: 0
  }

  // Step 1: Load Dinamik provider
  const provider = await db.supplier_providers.findFirst({
    where: {
      OR: [
        { code: { contains: 'dinamik', mode: 'insensitive' } },
        { name: { contains: 'dinamik', mode: 'insensitive' } }
      ]
    },
    select: { id: true, code: true }
  })

  if (!provider) {
    console.error('[generate-matches] No Dinamik provider found')
    process.exit(1)
  }
  console.log(`[generate-matches] Provider: ${provider.code} (id=${provider.id})`)

  // Step 2: Build normalized_model lookup from parcatedarik.product
  console.log('[generate-matches] Loading ParcaTedarik normalized_model index...')
  const ptModels = await db.$queryRaw<
    Array<{ id: number; model: string | null; normalized_model: string; manufacturer_id: number }>
  >(Prisma.sql`
    SELECT p.id, p.model, p.normalized_model, p.manufacturer_id
    FROM parcatedarik.product p
    WHERE p.normalized_model IS NOT NULL
      AND p.normalized_model <> ''
    ORDER BY p.normalized_model
  `)

  const normalizedModelToPcProducts = new Map<
    string,
    Array<{ id: number; model: string | null; manufacturer_id: number }>
  >()
  for (const pt of ptModels) {
    const key = pt.normalized_model
    if (!normalizedModelToPcProducts.has(key)) {
      normalizedModelToPcProducts.set(key, [])
    }
    normalizedModelToPcProducts.get(key)!.push({
      id: pt.id,
      model: pt.model,
      manufacturer_id: pt.manufacturer_id
    })
  }
  console.log(`[generate-matches] Loaded ${normalizedModelToPcProducts.size} distinct normalized_model values`)

  // Step 3: Load parcatedarik manufacturers for brand matching
  const manufacturers = await db.$queryRaw<
    Array<{ id: number; name: string }>
  >(Prisma.sql`SELECT id, name FROM parcatedarik.manufacturer`)

  const manufacturerMap = new Map<number, string>()
  const normalizedManufacturerMap = new Map<number, string>()
  for (const m of manufacturers) {
    manufacturerMap.set(m.id, m.name)
    normalizedManufacturerMap.set(m.id, normalizeModel(m.name) || '')
  }

  // Step 4: Load existing matches to deduplicate
  console.log('[generate-matches] Loading existing matches...')
  const existingMatches = await db.$queryRaw<
    Array<{
      dinamik_product_id: bigint
      parcatedarik_product_id: number
      dinamik_barcode_field: string
      normalized_barcode_value: string
    }>
  >(Prisma.sql`
    SELECT dinamik_product_id, parcatedarik_product_id, dinamik_barcode_field, normalized_barcode_value
    FROM public.dinamik_parcatedarik_model_matches
  `)

  const existingKeys = new Set<string>()
  for (const em of existingMatches) {
    existingKeys.add(
      `${em.dinamik_product_id}::${em.parcatedarik_product_id}::${em.dinamik_barcode_field}::${em.normalized_barcode_value}`
    )
  }
  console.log(`[generate-matches] ${existingKeys.size} existing matches`)

  // Step 5: Load Dinamik products with barcodes
  console.log('[generate-matches] Loading Dinamik products with barcodes...')
  const limitClause = LIMIT ? Prisma.sql`LIMIT ${LIMIT}` : Prisma.sql``

  const dinamikProducts = await db.$queryRaw<
    Array<{
      id: bigint
      stock_code: string
      stock_name: string | null
      brand: string | null
      barcode_1: string | null
      barcode_2: string | null
      barcode_3: string | null
      price: string | null
    }>
  >(Prisma.sql`
    SELECT d.id, d.stock_code, d.stock_name, d.brand,
           d.barcode_1, d.barcode_2, d.barcode_3, d.price
    FROM dinamik.products d
    WHERE d.barcode_1 IS NOT NULL AND d.barcode_1 <> ''
       OR d.barcode_2 IS NOT NULL AND d.barcode_2 <> ''
       OR d.barcode_3 IS NOT NULL AND d.barcode_3 <> ''
    ORDER BY d.id
    ${limitClause}
  `)

  stats.dinamikProductsScanned = dinamikProducts.length

  // Step 6: Match each barcode against normalized_model
  console.log('[generate-matches] Matching barcodes against normalized_model...')
  const candidatesToInsert: Array<{
    dinamik_product_id: bigint
    parcatedarik_product_id: number
    dinamik_barcode_field: string
    dinamik_barcode_value: string
    normalized_barcode_value: string
    parcatedarik_model: string
    normalized_model: string
    match_reason: string
    confidence: number
    status: string
  }> = []

  for (const d of dinamikProducts) {
    const barcodes: Array<{
      field: 'barcode_1' | 'barcode_2' | 'barcode_3'
      value: string | null
    }> = [
      { field: 'barcode_1', value: d.barcode_1 },
      { field: 'barcode_2', value: d.barcode_2 },
      { field: 'barcode_3', value: d.barcode_3 }
    ]

    let hasAnyBarcode = false
    for (const bc of barcodes) {
      if (bc.value && bc.value.trim()) {
        hasAnyBarcode = true
        break
      }
    }
    if (hasAnyBarcode) stats.dinamikProductsWithBarcode++

    const dinamikProductId = BigInt(d.id)

    for (const { field, value } of barcodes) {
      if (!value || !value.trim()) continue

      stats.barcodeValuesChecked++
      const normalizedValue = normalizeModel(value)
      if (!normalizedValue) continue

      const pcProducts = normalizedModelToPcProducts.get(normalizedValue)
      if (!pcProducts || pcProducts.length === 0) continue

      stats.exactMatchesFound += pcProducts.length

      const dinamikBrand = normalizeModel(d.brand)

      if (pcProducts.length === 1) {
        const pt = pcProducts[0]
        const key = `${dinamikProductId}::${pt.id}::${field}::${normalizedValue}`
        if (existingKeys.has(key)) continue

        const normalizedMfrName = normalizedManufacturerMap.get(pt.manufacturer_id) || ''
        const brandMatch = !!(dinamikBrand && normalizedMfrName && dinamikBrand === normalizedMfrName)

        let confidence: number
        let matchReason: string
        switch (field) {
          case 'barcode_1':
            confidence = 0.98
            matchReason = 'BARCODE_1_MODEL_EXACT'
            break
          case 'barcode_2':
            confidence = 0.96
            matchReason = 'BARCODE_2_MODEL_EXACT'
            break
          case 'barcode_3':
            confidence = 0.94
            matchReason = 'BARCODE_3_MODEL_EXACT'
            break
        }
        if (brandMatch) confidence = Math.min(confidence + 0.01, 0.99)
        confidence = Math.round(confidence * 10000) / 10000

        stats.uniqueMatches++
        candidatesToInsert.push({
          dinamik_product_id: dinamikProductId,
          parcatedarik_product_id: pt.id,
          dinamik_barcode_field: field,
          dinamik_barcode_value: value.trim(),
          normalized_barcode_value: normalizedValue,
          parcatedarik_model: pt.model || '',
          normalized_model: normalizedValue,
          match_reason: matchReason,
          confidence,
          status: DEFAULT_STATUS
        })
        existingKeys.add(key)
      } else {
        for (const pt of pcProducts) {
          const key = `${dinamikProductId}::${pt.id}::${field}::${normalizedValue}`
          if (existingKeys.has(key)) continue

          const normalizedMfrName = normalizedManufacturerMap.get(pt.manufacturer_id) || ''
          const brandMatch = !!(dinamikBrand && normalizedMfrName && dinamikBrand === normalizedMfrName)

          let confidence: number
          let matchReason: string
          switch (field) {
            case 'barcode_1':
              confidence = 0.98
              matchReason = 'BARCODE_1_MODEL_EXACT'
              break
            case 'barcode_2':
              confidence = 0.96
              matchReason = 'BARCODE_2_MODEL_EXACT'
              break
            case 'barcode_3':
              confidence = 0.94
              matchReason = 'BARCODE_3_MODEL_EXACT'
              break
          }
          if (brandMatch) confidence = Math.min(confidence + 0.01, 0.99)
          confidence = Math.round(confidence * 10000) / 10000

          stats.multipleMatches++
          stats.needsReview++
          candidatesToInsert.push({
            dinamik_product_id: dinamikProductId,
            parcatedarik_product_id: pt.id,
            dinamik_barcode_field: field,
            dinamik_barcode_value: value.trim(),
            normalized_barcode_value: normalizedValue,
            parcatedarik_model: pt.model || '',
            normalized_model: normalizedValue,
            match_reason: 'MULTIPLE_PARCA_MODEL_MATCHES',
            confidence,
            status: 'NEEDS_REVIEW'
          })
          existingKeys.add(key)
        }
      }
    }
  }

  stats.candidatesWouldInsert = candidatesToInsert.length

  console.log()
  console.log('=== Generation Summary ===')
  console.log(`  dinamikProductsScanned:     ${stats.dinamikProductsScanned}`)
  console.log(`  dinamikProductsWithBarcode:  ${stats.dinamikProductsWithBarcode}`)
  console.log(`  barcodeValuesChecked:        ${stats.barcodeValuesChecked}`)
  console.log(`  exactMatchesFound:           ${stats.exactMatchesFound}`)
  console.log(`  uniqueMatches:               ${stats.uniqueMatches}`)
  console.log(`  multipleMatches:             ${stats.multipleMatches}`)
  console.log(`  needsReview:                 ${stats.needsReview}`)
  console.log(`  candidatesWouldInsert:       ${stats.candidatesWouldInsert}`)

  // Print sample matches
  console.log()
  console.log('=== Sample Matches (first 20) ===')
  for (const c of candidatesToInsert.slice(0, 20)) {
    console.log(
      `  din_id=${c.dinamik_product_id} pt_id=${c.parcatedarik_product_id} ` +
      `${c.dinamik_barcode_field}="${c.dinamik_barcode_value}" ` +
      `→ model="${c.parcatedarik_model}" conf=${c.confidence} ` +
      `reason=${c.match_reason} status=${c.status}`
    )
  }

  if (DRY_RUN) {
    console.log()
    console.log('[generate-matches] DRY_RUN mode - no database writes performed.')
    console.log('[generate-matches] Re-run with APPLY=true to apply changes.')
    await db.$disconnect()
    return
  }

  // Step 7: Insert candidates in batches
  console.log()
  console.log('[generate-matches] Inserting candidates...')
  let totalInserted = 0

  for (let i = 0; i < candidatesToInsert.length; i += BATCH_SIZE) {
    const batch = candidatesToInsert.slice(i, i + BATCH_SIZE)
    const valuesClauses = batch.map((c) => {
      const dv = c.dinamik_barcode_value.replace(/'/g, "''")
      const pm = c.parcatedarik_model.replace(/'/g, "''")
      return `(${c.dinamik_product_id}, ${c.parcatedarik_product_id}, '${c.dinamik_barcode_field}', '${dv}', '${c.normalized_barcode_value}', '${pm}', '${c.normalized_model}', '${c.match_reason}', ${c.confidence}, '${c.status}')`
    })

    const sql = `
      INSERT INTO public.dinamik_parcatedarik_model_matches (
        dinamik_product_id, parcatedarik_product_id, dinamik_barcode_field,
        dinamik_barcode_value, normalized_barcode_value, parcatedarik_model,
        normalized_model, match_reason, confidence, status
      ) VALUES ${valuesClauses.join(', ')}
      ON CONFLICT (dinamik_product_id, parcatedarik_product_id, dinamik_barcode_field, normalized_barcode_value)
      DO NOTHING
    `

    try {
      const result = await db.$executeRawUnsafe(sql)
      totalInserted += result
      console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: inserted ${result} rows`)
    } catch (error) {
      console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: error inserting`, error)
      stats.errors++
    }
  }

  stats.candidatesInserted = totalInserted
  console.log()
  console.log(`[generate-matches] Total candidates inserted: ${totalInserted}`)

  // Step 8: Validation counts
  console.log()
  console.log('=== Validation ===')

  const totalMatches = await db.$queryRaw<
    Array<{ count: bigint }>
  >(Prisma.sql`SELECT COUNT(*) AS count FROM public.dinamik_parcatedarik_model_matches`)
  console.log(`  Total matches in table: ${totalMatches[0].count}`)

  const byStatus = await db.$queryRaw<
    Array<{ status: string; count: bigint }>
  >(Prisma.sql`
    SELECT status, COUNT(*) AS count
    FROM public.dinamik_parcatedarik_model_matches
    GROUP BY status
    ORDER BY count DESC
  `)
  for (const row of byStatus) {
    console.log(`  ${row.status}: ${row.count}`)
  }

  const byReason = await db.$queryRaw<
    Array<{ match_reason: string; count: bigint }>
  >(Prisma.sql`
    SELECT match_reason, COUNT(*) AS count
    FROM public.dinamik_parcatedarik_model_matches
    GROUP BY match_reason
    ORDER BY count DESC
  `)
  for (const row of byReason) {
    console.log(`  ${row.match_reason}: ${row.count}`)
  }

  console.log()
  console.log('[generate-matches] Done.')
  await db.$disconnect()
}

main().catch((err) => {
  console.error('[generate-matches] Fatal error:', err)
  process.exit(1)
})