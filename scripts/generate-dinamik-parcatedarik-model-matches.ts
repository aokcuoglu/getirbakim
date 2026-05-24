/**
 * Populate parcatedarik.dpmatch with individual dproducts and product rows
 * (not cross-join pairs). Each dproduct and product gets one row.
 * EXACT_MATCH updates the dproduct placeholder row in place.
 *
 * Usage:
 *   APPLY=true bun scripts/generate-dinamik-parcatedarik-model-matches.ts
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'
import { normalizeModel } from '../lib/matching/code-normalization'
import { applyExactDpmatchLinks } from '../lib/admin/dpmatch-link'

const DRY_RUN = process.env.APPLY !== 'true'
const BATCH_SIZE = 500

interface Stats {
  brandMatches: number
  dproductRows: number
  productRows: number
  exactMatches: number
  exactUpdated: number
  orphanRowsDeleted: number
  inserted: number
  skipped: number
}

async function main() {
  console.log('[generate-dpmatch] Populate dpmatch — tekil approach')
  console.log(`[generate-dpmatch] MODE = ${DRY_RUN ? 'DRY_RUN' : 'APPLY'}`)
  console.log()

  const stats: Stats = {
    brandMatches: 0,
    dproductRows: 0,
    productRows: 0,
    exactMatches: 0,
    exactUpdated: 0,
    orphanRowsDeleted: 0,
    inserted: 0,
    skipped: 0,
  }

  const brandMatchRows = await db.$queryRaw<
    Array<{ dbrands_id: string; manufacturer_id: number }>
  >(Prisma.sql`
    SELECT dbrands_id, manufacturer_id
    FROM parcatedarik.dbrands_match
    WHERE mapping_status = 'APPROVED'
    ORDER BY dbrands_id
  `)
  stats.brandMatches = brandMatchRows.length
  console.log(`[generate-dpmatch] ${stats.brandMatches} approved brand matches`)

  if (brandMatchRows.length === 0) { await db.$disconnect(); return }

  const exactLinks: Array<{ dproductsId: bigint; productId: number; normalized: string }> = []

  let idx = 0
  for (const bm of brandMatchRows) {
    idx++
    if (idx % 100 === 0) console.log(`[generate-dpmatch] Processing ${idx}/${stats.brandMatches}...`)

    const dproducts = await db.$queryRaw<
      Array<{ id: bigint; part_no: string | null; barcode_1: string | null; barcode_2: string | null; barcode_3: string | null }>
    >(Prisma.sql`
      SELECT id, part_no, barcode_1, barcode_2, barcode_3
      FROM parcatedarik.dproducts
      WHERE BTRIM(LOWER(COALESCE(brand, ''))) = BTRIM(LOWER(${bm.dbrands_id}))
    `)

    const products = await db.$queryRaw<
      Array<{ id: number; model: string | null; normalized_model: string | null }>
    >(Prisma.sql`
      SELECT id, model, normalized_model
      FROM parcatedarik.product
      WHERE manufacturer_id = ${bm.manufacturer_id}
    `)

    if (dproducts.length === 0 && products.length === 0) continue

    const dpValues: string[] = []
    for (const dp of dproducts) {
      dpValues.push(`(${dp.id}, NULL, 'PENDING')`)
      stats.dproductRows++
    }
    if (dpValues.length > 0) {
      await batchInsert(
        dpValues,
        stats,
        'INSERT INTO parcatedarik.dpmatch (dproducts_id, product_id, mapping_status) VALUES ',
        'ON CONFLICT (dproducts_id) WHERE dproducts_id IS NOT NULL DO NOTHING'
      )
    }

    const pValues: string[] = []
    for (const p of products) {
      pValues.push(`(NULL, ${p.id}, 'PENDING')`)
      stats.productRows++
    }
    if (pValues.length > 0) {
      await batchInsert(
        pValues,
        stats,
        'INSERT INTO parcatedarik.dpmatch (dproducts_id, product_id, mapping_status) VALUES ',
        'ON CONFLICT (product_id) WHERE product_id IS NOT NULL DO NOTHING'
      )
    }

    for (const dp of dproducts) {
      const normFields = [
        dp.part_no ? normalizeModel(dp.part_no) : '',
        dp.barcode_1 ? normalizeModel(dp.barcode_1) : '',
        dp.barcode_2 ? normalizeModel(dp.barcode_2) : '',
        dp.barcode_3 ? normalizeModel(dp.barcode_3) : '',
      ]
      let matched = false
      for (const p of products) {
        if (matched) break
        const productModel = p.normalized_model || (p.model ? normalizeModel(p.model) : '')
        if (!productModel) continue
        for (const nf of normFields) {
          if (nf && nf === productModel) {
            exactLinks.push({ dproductsId: dp.id, productId: p.id, normalized: nf })
            stats.exactMatches++
            matched = true
            break
          }
        }
      }
    }
  }

  if (!DRY_RUN && exactLinks.length > 0) {
    for (let i = 0; i < exactLinks.length; i += BATCH_SIZE) {
      const batch = exactLinks.slice(i, i + BATCH_SIZE)
      const result = await applyExactDpmatchLinks(batch)
      stats.exactUpdated += result.updated
      stats.orphanRowsDeleted += result.deletedOrphans
    }
  }

  console.log()
  console.log('=== Summary ===')
  console.log(`  Brand matches:       ${stats.brandMatches}`)
  console.log(`  Dproduct rows:       ${stats.dproductRows}`)
  console.log(`  Product rows:        ${stats.productRows}`)
  console.log(`  Exact matches:       ${stats.exactMatches}`)
  if (!DRY_RUN) console.log(`  Exact updated:       ${stats.exactUpdated}`)
  if (!DRY_RUN) console.log(`  Orphan rows deleted: ${stats.orphanRowsDeleted}`)
  if (!DRY_RUN) console.log(`  Inserted:            ${stats.inserted}`)
  if (!DRY_RUN) console.log(`  Skipped:             ${stats.skipped}`)
  console.log(`  Total placeholders:  ${stats.dproductRows + stats.productRows}`)
  console.log('[generate-dpmatch] Done.')
  await db.$disconnect()
}

async function batchInsert(values: string[], stats: Stats, prefix: string, suffix: string) {
  if (DRY_RUN) return
  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE)
    const sql = `${prefix} ${batch.join(', ')} ${suffix}`
    try {
      const result = await db.$executeRawUnsafe(sql)
      stats.inserted += result
      stats.skipped += batch.length - result
    } catch (e) {
      console.error(`  Batch error:`, String(e).slice(0, 300))
      console.error(`  SQL sample: ${sql.slice(0, 200)}`)
    }
  }
}

main().catch(err => { console.error('[generate-dpmatch] Fatal:', err); process.exit(1) })
