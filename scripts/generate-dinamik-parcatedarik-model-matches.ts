/**
 * Populate parcatedarik.dpmatch with all dproducts × product pairs
 * where the brand/manufacturer relationship is APPROVED in dbrands_match.
 *
 * Streams per-brand: processes one brand at a time to avoid OOM.
 * Exact matches auto-approved. Others left as PENDING.
 *
 * Usage:
 *   DRY_RUN=true  bun scripts/generate-dinamik-parcatedarik-model-matches.ts
 *   APPLY=true    bun scripts/generate-dinamik-parcatedarik-model-matches.ts
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'
import { normalizeModel } from '../lib/matching/code-normalization'

const DRY_RUN = process.env.APPLY !== 'true'
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '500', 10)

interface Stats {
  brandMatches: number
  dproductsTotal: number
  productsTotal: number
  pairsTotal: number
  exactMatches: number
  pending: number
  inserted: number
  skipped: number
  errors: number
}

async function processBrand(db_id: string, manufacturer_id: number, stats: Stats) {
  // Load dproducts for this brand
  const dproducts = await db.$queryRaw<
    Array<{
      id: bigint
      barcode_1: string | null; barcode_2: string | null; barcode_3: string | null
      part_no: string | null
    }>
  >(Prisma.sql`
    SELECT id, barcode_1, barcode_2, barcode_3, part_no
    FROM parcatedarik.dproducts
    WHERE BTRIM(LOWER(COALESCE(brand, ''))) = BTRIM(LOWER(${db_id}))
  `)
  stats.dproductsTotal += dproducts.length
  if (dproducts.length === 0) return

  // Load products for this manufacturer
  const products = await db.$queryRaw<
    Array<{
      id: number
      model: string | null; normalized_model: string | null
    }>
  >(Prisma.sql`
    SELECT id, model, normalized_model
    FROM parcatedarik.product
    WHERE manufacturer_id = ${manufacturer_id}
  `)
  stats.productsTotal += products.length
  if (products.length === 0) return

  // Generate pairs as VALUES strings, batch insert
  const valuesList: string[] = []
  for (const dp of dproducts) {
    for (const p of products) {
      stats.pairsTotal++

      const dprodsModel = dp.part_no
      const normFields = [
        (dprodsModel ? normalizeModel(dprodsModel) : ''),
        (dp.barcode_1 ? normalizeModel(dp.barcode_1) : ''),
        (dp.barcode_2 ? normalizeModel(dp.barcode_2) : ''),
        (dp.barcode_3 ? normalizeModel(dp.barcode_3) : ''),
      ]
      const productModel = p.normalized_model || (p.model ? normalizeModel(p.model) : '')

      let isExact = false
      let normVal: string | null = null
      for (const nf of normFields) {
        if (nf && productModel && nf === productModel) { isExact = true; normVal = nf; break }
      }

      const status = isExact ? 'APPROVED' : 'PENDING'
      const method = isExact ? 'EXACT_MATCH' : null
      const nEscape = normVal ? `'${normVal.replace(/'/g, "''")}'` : 'NULL'
      const mEscape = method ? `'${method}'` : 'NULL'

      valuesList.push(`(${dp.id}, ${p.id}, '${status}', ${mEscape}, ${nEscape})`)

      if (valuesList.length >= BATCH_SIZE) {
        await insertBatch(valuesList, stats)
        valuesList.length = 0
      }
    }
  }
  if (valuesList.length > 0) {
    await insertBatch(valuesList, stats)
  }
}

async function insertBatch(valuesList: string[], stats: Stats) {
  const exactCount = valuesList.filter(v => v.includes("'APPROVED'")).length
  const pendingCount = valuesList.length - exactCount
  stats.exactMatches += exactCount
  stats.pending += pendingCount

  if (DRY_RUN) return

  const sql = `
    INSERT INTO parcatedarik.dpmatch (dproducts_id, product_id, mapping_status, match_method, normalized)
    VALUES ${valuesList.join(', ')}
    ON CONFLICT (dproducts_id, product_id) DO NOTHING
  `
  try {
    const result = await db.$executeRawUnsafe(sql)
    stats.inserted += result
    stats.skipped += valuesList.length - result
  } catch (error) {
    stats.errors++
    console.error(`[generate-dpmatch] Batch insert error:`, String(error).slice(0, 200))
  }
}

async function main() {
  console.log('[generate-dpmatch] Populate dpmatch (streaming)')
  console.log(`[generate-dpmatch] MODE  = ${DRY_RUN ? 'DRY_RUN' : 'APPLY'}`)
  console.log()

  const stats: Stats = { brandMatches: 0, dproductsTotal: 0, productsTotal: 0, pairsTotal: 0, exactMatches: 0, pending: 0, inserted: 0, skipped: 0, errors: 0 }

  // Load APPROVED brand matches
  const brandMatchRows = await db.$queryRaw<
    Array<{ dbrands_id: string; manufacturer_id: number }>
  >(Prisma.sql`
    SELECT dbrands_id, manufacturer_id
    FROM parcatedarik.dbrands_match
    WHERE mapping_status = 'APPROVED'
    ORDER BY dbrands_id
  `)
  stats.brandMatches = brandMatchRows.length
  console.log(`[generate-dpmatch] ${stats.brandMatches} APPROVED brand matches`)

  if (brandMatchRows.length === 0) {
    console.log('[generate-dpmatch] No approved brand matches.')
    await db.$disconnect()
    return
  }

  let idx = 0
  for (const bm of brandMatchRows) {
    idx++
    if (idx % 50 === 0) console.log(`[generate-dpmatch] Processing ${idx}/${stats.brandMatches}... pairs=${stats.pairsTotal}`)
    await processBrand(bm.dbrands_id, bm.manufacturer_id, stats)
  }

  console.log()
  console.log('=== Summary ===')
  console.log(`  Brands processed:    ${stats.brandMatches}`)
  console.log(`  dproducts loaded:    ${stats.dproductsTotal}`)
  console.log(`  products loaded:     ${stats.productsTotal}`)
  console.log(`  Pairs generated:     ${stats.pairsTotal}`)
  console.log(`  Exact matches:       ${stats.exactMatches}`)
  console.log(`  Pending:             ${stats.pending}`)
  if (!DRY_RUN) console.log(`  Inserted:            ${stats.inserted}`)
  if (!DRY_RUN) console.log(`  Skipped (exists):    ${stats.skipped}`)
  if (stats.errors > 0) console.log(`  Errors:              ${stats.errors}`)
  console.log('[generate-dpmatch] Done.')
  await db.$disconnect()
}

main().catch(err => {
  console.error('[generate-dpmatch] Fatal:', err)
  process.exit(1)
})
